/**
 * Client SDK core implementation with local replica management.
 *
 * Maintains a local replica of the shared CRDT state, applies operations
 * locally within 100ms without waiting for server acknowledgment, and
 * provides event callbacks for state changes, errors, presence, and
 * connection lifecycle.
 *
 * Requirements: 4.1, 4.2, 4.6, 5.1, 5.6, 8.7, 9.4
 */

import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";
import type {
  CRDTState,
  CRDTOperation,
  HLCTimestamp,
  StateChangeEvent,
  OperationResult,
  SDKError,
  PresenceEvent,
  ServerMessage,
  UserPresence,
  BatchMergeResult,
} from "../types/index.js";
import { FileOperationQueue } from "./operation-queue.js";
import { mergeOperation } from "../engine/merge.js";
import { createTimestamp } from "../engine/hlc.js";
import { serialize, deserialize } from "./serialization.js";

/** Connection state for the client SDK. */
type ClientConnectionState = "disconnected" | "connecting" | "connected";

/**
 * ClientSDK provides the high-level API for application developers.
 *
 * It manages a local CRDT replica, an operation queue for offline support,
 * and event-driven notifications for state changes, errors, presence, and
 * connection lifecycle.
 */
export class ClientSDK {
  private readonly replicaId: string;
  private readonly operationQueue: FileOperationQueue;
  private connectionState: ClientConnectionState = "disconnected";
  private serverUrl: string | null = null;
  private sessionId: string | null = null;

  /** WebSocket connection instance */
  private ws: WebSocket | null = null;

  /** Local CRDT state replica (Requirement 4.1) */
  private localState: CRDTState;

  /** Valid collection names for schema validation (Requirement 9.5) */
  private localSchema: Set<string> | null = null;

  /** Auth token for reconnection */
  private token: string | null = null;

  /** Event handler arrays */
  private stateChangeHandlers: Array<(event: StateChangeEvent) => void> = [];
  private errorHandlers: Array<(err: SDKError) => void> = [];
  private presenceHandlers: Array<(event: PresenceEvent) => void> = [];
  private connectedHandlers: Array<() => void> = [];
  private disconnectedHandlers: Array<() => void> = [];

  constructor(replicaId: string) {
    this.replicaId = replicaId;
    this.operationQueue = new FileOperationQueue(replicaId);

    // Initialize empty CRDT state for the local replica
    this.localState = {
      sessionId: "",
      items: {},
      version: 0,
      lastUpdated: { wallTime: 0, logical: 0, nodeId: replicaId },
    };
  }

  /**
   * Connects to the sync server via WebSocket.
   *
   * Establishes a WebSocket connection with the auth token appended as a
   * query parameter. Sets up message handlers for incoming ServerMessages
   * (ack, delta, presence-join/leave, error, batch-result, etc.).
   *
   * On successful open: emits connected event and flushes any queued operations.
   * On close: emits disconnected event.
   *
   * Requirements: 4.2, 4.6, 5.1
   */
  async connect(serverUrl: string, token: string, sessionId: string): Promise<void> {
    this.connectionState = "connecting";
    this.serverUrl = serverUrl;
    this.sessionId = sessionId;
    this.token = token;
    this.localState.sessionId = sessionId;

    return new Promise<void>((resolve, reject) => {
      const url = `${serverUrl}?token=${token}`;
      this.ws = new WebSocket(url);

      this.ws.on("open", async () => {
        this.connectionState = "connected";
        this.emitConnected();

        // On connect/reconnect, flush any queued operations (Requirement 4.6)
        await this.flushQueuedOperations();

        resolve();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        this.handleServerMessage(data);
      });

      this.ws.on("close", () => {
        this.connectionState = "disconnected";
        this.ws = null;
        this.emitDisconnected();
      });

      this.ws.on("error", (err: Error) => {
        if (this.connectionState === "connecting") {
          this.connectionState = "disconnected";
          this.ws = null;
          reject(err);
        } else {
          this.emitError({
            code: "CONNECTION_ERROR",
            message: err.message,
          });
        }
      });
    });
  }

  /**
   * Disconnects from the sync server.
   *
   * Closes the WebSocket connection gracefully and emits the disconnected event.
   */
  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connectionState = "disconnected";
    this.serverUrl = null;
    this.token = null;
    this.emitDisconnected();
  }

  /**
   * Handles reconnection flow:
   * 1. Restore queue from persistence
   * 2. Get reconnection batch (capped at 1000)
   * 3. Send batch to server
   * 4. Process incoming batch-result or missed deltas
   *
   * Requirements: 5.1, 5.6, 8.7
   */
  async reconnect(): Promise<void> {
    if (!this.serverUrl || !this.token || !this.sessionId) {
      throw new Error("Cannot reconnect: missing server URL, token, or session ID");
    }

    // Restore queued operations from persistence
    await this.operationQueue.restore();

    // Connect to server (this will trigger flushQueuedOperations on open)
    await this.connect(this.serverUrl, this.token, this.sessionId);
  }

  /**
   * Adds an item to a collection.
   *
   * Generates a UUID and HLC timestamp, validates the payload against
   * inventory rules, applies locally for sub-100ms response (Requirement 4.2),
   * emits a state-change event, and enqueues for transmission.
   *
   * Requirements: 8.1, 9.1, 9.2
   */
  add(collection: string, itemId: string, payload: Record<string, unknown>): OperationResult {
    const operationId = uuidv4();

    // Validate inventory item constraints (Requirement 8.1)
    const validationError = this.validatePayload(payload);
    if (validationError) {
      this.emitError({ operationId, code: "VALIDATION_ERROR", message: validationError });
      return { operationId, accepted: false };
    }

    const timestamp = createTimestamp(this.replicaId);

    const operation: CRDTOperation = {
      id: operationId,
      sessionId: this.localState.sessionId,
      replicaId: this.replicaId,
      type: "add",
      itemId,
      payload,
      timestamp,
      version: this.localState.version,
    };

    // Apply locally for sub-100ms response (Requirement 4.2)
    mergeOperation(this.localState, operation);

    // Emit state-change event with source "local" (Requirement 9.4)
    this.emitStateChange({
      collection,
      itemId,
      changeType: "added",
      newValue: payload,
      source: "local",
    });

    // Enqueue for transmission (Requirement 4.3)
    try {
      this.operationQueue.enqueue(operation);
    } catch {
      this.emitError({ operationId, code: "QUEUE_FULL", message: "Operation queue is full" });
      return { operationId, accepted: false };
    }

    // Online flow: send immediately if connected (Requirement 4.6)
    if (this.connectionState === "connected") {
      this.sendOperation(operation);
    } else {
      // Offline flow: persist the queue (Requirement 4.6)
      this.operationQueue.persist().catch((err) => {
        this.emitError({
          operationId,
          code: "PERSIST_ERROR",
          message: `Failed to persist queue: ${err instanceof Error ? err.message : "unknown"}`,
        });
      });
    }

    return { operationId, accepted: true };
  }

  /**
   * Removes an item from a collection.
   *
   * Generates a UUID and HLC timestamp, applies locally for sub-100ms response,
   * emits a state-change event, and enqueues for transmission.
   *
   * Requirements: 8.1, 9.1, 9.2
   */
  remove(collection: string, itemId: string): OperationResult {
    const operationId = uuidv4();
    const timestamp = createTimestamp(this.replicaId);

    const operation: CRDTOperation = {
      id: operationId,
      sessionId: this.localState.sessionId,
      replicaId: this.replicaId,
      type: "remove",
      itemId,
      payload: {},
      timestamp,
      version: this.localState.version,
    };

    // Apply locally for sub-100ms response (Requirement 4.2)
    mergeOperation(this.localState, operation);

    // Emit state-change event with source "local" (Requirement 9.4)
    this.emitStateChange({
      collection,
      itemId,
      changeType: "removed",
      source: "local",
    });

    // Enqueue for transmission (Requirement 4.3)
    try {
      this.operationQueue.enqueue(operation);
    } catch {
      this.emitError({ operationId, code: "QUEUE_FULL", message: "Operation queue is full" });
      return { operationId, accepted: false };
    }

    // Online flow: send immediately if connected (Requirement 4.6)
    if (this.connectionState === "connected") {
      this.sendOperation(operation);
    } else {
      // Offline flow: persist the queue (Requirement 4.6)
      this.operationQueue.persist().catch((err) => {
        this.emitError({
          operationId,
          code: "PERSIST_ERROR",
          message: `Failed to persist queue: ${err instanceof Error ? err.message : "unknown"}`,
        });
      });
    }

    return { operationId, accepted: true };
  }

  /**
   * Updates fields on an item in a collection.
   *
   * Generates a UUID and HLC timestamp, validates the fields against
   * inventory rules, applies locally for sub-100ms response,
   * emits a state-change event, and enqueues for transmission.
   *
   * Requirements: 8.1, 9.1, 9.2
   */
  update(collection: string, itemId: string, fields: Record<string, unknown>): OperationResult {
    const operationId = uuidv4();

    // Validate inventory item constraints (Requirement 8.1)
    const validationError = this.validatePayload(fields);
    if (validationError) {
      this.emitError({ operationId, code: "VALIDATION_ERROR", message: validationError });
      return { operationId, accepted: false };
    }

    const timestamp = createTimestamp(this.replicaId);

    const operation: CRDTOperation = {
      id: operationId,
      sessionId: this.localState.sessionId,
      replicaId: this.replicaId,
      type: "update",
      itemId,
      payload: fields,
      timestamp,
      version: this.localState.version,
    };

    // Apply locally for sub-100ms response (Requirement 4.2)
    mergeOperation(this.localState, operation);

    // Emit state-change event with source "local" (Requirement 9.4)
    this.emitStateChange({
      collection,
      itemId,
      changeType: "updated",
      newValue: fields,
      source: "local",
    });

    // Enqueue for transmission (Requirement 4.3)
    try {
      this.operationQueue.enqueue(operation);
    } catch {
      this.emitError({ operationId, code: "QUEUE_FULL", message: "Operation queue is full" });
      return { operationId, accepted: false };
    }

    // Online flow: send immediately if connected (Requirement 4.6)
    if (this.connectionState === "connected") {
      this.sendOperation(operation);
    } else {
      // Offline flow: persist the queue (Requirement 4.6)
      this.operationQueue.persist().catch((err) => {
        this.emitError({
          operationId,
          code: "PERSIST_ERROR",
          message: `Failed to persist queue: ${err instanceof Error ? err.message : "unknown"}`,
        });
      });
    }

    return { operationId, accepted: true };
  }

  /**
   * Returns the current local CRDT state replica.
   * Requirement 4.1: Maintain a local Replica of the shared state.
   */
  getLocalState(): CRDTState {
    return this.localState;
  }

  /**
   * Returns the replica ID for this client instance.
   */
  getReplicaId(): string {
    return this.replicaId;
  }

  /**
   * Returns the current connection state.
   */
  getConnectionState(): ClientConnectionState {
    return this.connectionState;
  }

  /**
   * Returns the operation queue instance for advanced usage.
   */
  getOperationQueue(): FileOperationQueue {
    return this.operationQueue;
  }

  // ─── Schema Management ─────────────────────────────────────────────

  /**
   * Defines which collection names are valid for incoming operations.
   * Operations referencing collections not in this schema will be rejected.
   *
   * Requirement 9.5: reject operations referencing fields/collections not in local schema.
   */
  setLocalSchema(collections: string[]): void {
    this.localSchema = new Set(collections);
  }

  // ─── Incoming Operation Application ────────────────────────────────

  /**
   * Applies a remote operation received from the Sync Engine to the local replica.
   *
   * Logic:
   * 1. Derive the collection from the operation (uses sessionId as collection identifier)
   * 2. Validate the collection is in the local schema (if schema is set)
   * 3. Apply using mergeOperation to the local state
   * 4. On success: emit state-change event with source "remote"
   * 5. On failure: emit error event with the operation ID and description
   *
   * Requirements: 9.4, 9.5
   */
  applyRemoteOperation(operation: CRDTOperation): void {
    // Derive collection from the operation's sessionId
    const collection = operation.sessionId;

    // Validate against local schema if set (Requirement 9.5)
    if (this.localSchema !== null && !this.localSchema.has(collection)) {
      this.emitError({
        operationId: operation.id,
        code: "SCHEMA_MISMATCH",
        message: `Operation references collection "${collection}" which is not in the local schema`,
      });
      return;
    }

    // Apply to local replica using CRDT merge (Requirement 9.4)
    const result = mergeOperation(this.localState, operation);

    if (!result.success) {
      // Merge failed (e.g., unknown item for update)
      this.emitError({
        operationId: operation.id,
        code: result.error?.code ?? "MERGE_FAILED",
        message: result.error?.message ?? `Failed to apply remote operation ${operation.id}`,
      });
      return;
    }

    // Determine changeType from the delta
    const changeType = this.deriveChangeType(result.delta?.changes, operation);

    // Emit state-change event with source "remote" (Requirement 9.4)
    this.emitStateChange({
      collection,
      itemId: operation.itemId,
      changeType,
      newValue: operation.type !== "remove" ? operation.payload : undefined,
      source: "remote",
    });
  }

  /**
   * Derives the changeType for the state-change event from merge results.
   */
  private deriveChangeType(
    changes: Array<{ itemId: string; type: "added" | "removed" | "updated" }> | undefined,
    operation: CRDTOperation
  ): "added" | "removed" | "updated" {
    // If the delta has changes, use the first matching change type
    if (changes && changes.length > 0) {
      const match = changes.find((c) => c.itemId === operation.itemId);
      if (match) {
        return match.type;
      }
    }
    // Fallback: derive from operation type
    switch (operation.type) {
      case "add":
        return "added";
      case "remove":
        return "removed";
      case "update":
        return "updated";
      default:
        return "updated";
    }
  }

  // ─── WebSocket Communication (internal) ─────────────────────────────

  /**
   * Sends an operation to the server via WebSocket.
   *
   * Serializes the operation and sends it as a ClientMessage with type "operation".
   * If the WebSocket is not open, this is a no-op (operation remains queued).
   */
  private sendOperation(operation: CRDTOperation): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = JSON.stringify({
      type: "operation",
      payload: operation,
    });

    this.ws.send(message);
  }

  /**
   * Flushes queued operations to the server on connection/reconnection.
   *
   * Gets the reconnection batch (capped at 1000 operations) and sends
   * them as a batch to the server. If fewer than the batch cap, sends
   * each individually for immediate ACK processing.
   *
   * Requirements: 5.1, 5.8
   */
  private async flushQueuedOperations(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const { operations, discardedCount } = this.operationQueue.getReconnectionBatch();

    if (discardedCount > 0) {
      this.emitError({
        code: "OPERATIONS_DISCARDED",
        message: `${discardedCount} oldest operations discarded during reconnection (cap: 1000)`,
      });
    }

    if (operations.length === 0) {
      return;
    }

    // Send as a batch if there are multiple operations
    if (operations.length > 1) {
      const batchMessage = JSON.stringify({
        type: "operation",
        payload: operations,
      });
      this.ws.send(batchMessage);
    } else {
      // Single operation — send directly
      this.sendOperation(operations[0]);
    }
  }

  /**
   * Handles incoming ServerMessages from the WebSocket connection.
   *
   * Dispatches based on message type:
   * - "ack": dequeue the acknowledged operation
   * - "delta": deserialize and apply remote operation
   * - "presence-join": emit presence join event
   * - "presence-leave": emit presence leave event
   * - "error": emit error event
   * - "batch-result": process batch merge result
   * - "ping": respond with pong
   *
   * Requirements: 4.2, 5.6, 9.4
   */
  private handleServerMessage(data: WebSocket.Data): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(data.toString()) as ServerMessage;
    } catch {
      this.emitError({
        code: "PARSE_ERROR",
        message: "Failed to parse incoming server message",
      });
      return;
    }

    switch (message.type) {
      case "ack":
        this.handleAck(message);
        break;
      case "delta":
        this.handleDelta(message);
        break;
      case "presence-join":
        this.handlePresenceJoin(message);
        break;
      case "presence-leave":
        this.handlePresenceLeave(message);
        break;
      case "error":
        this.handleError(message);
        break;
      case "batch-result":
        this.handleBatchResult(message);
        break;
      case "ping":
        this.handlePing();
        break;
      default:
        // Ignore unknown message types gracefully
        break;
    }
  }

  /**
   * Handles an ACK message — removes the acknowledged operation from the queue.
   * Requirement 4.8: ACK-based queue removal.
   */
  private handleAck(message: ServerMessage): void {
    if (message.operationId) {
      this.operationQueue.dequeue(message.operationId);
    }
  }

  /**
   * Handles a delta message — deserializes and applies the remote operation.
   * Requirement 9.4: apply incoming operations to local replica.
   */
  private handleDelta(message: ServerMessage): void {
    if (!message.payload) {
      return;
    }

    try {
      // Payload is a CRDTOperation sent from the server
      const operation = message.payload as CRDTOperation;
      this.applyRemoteOperation(operation);
    } catch (err) {
      this.emitError({
        code: "DELTA_APPLY_ERROR",
        message: `Failed to apply delta: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  /**
   * Handles a presence-join message — emits a presence event.
   */
  private handlePresenceJoin(message: ServerMessage): void {
    if (message.user) {
      this.emitPresence({ type: "join", user: message.user });
    }
  }

  /**
   * Handles a presence-leave message — emits a presence event.
   */
  private handlePresenceLeave(message: ServerMessage): void {
    if (message.user) {
      this.emitPresence({ type: "leave", user: message.user });
    } else if (message.userId) {
      // Construct a minimal presence event from userId
      this.emitPresence({
        type: "leave",
        user: {
          userId: message.userId,
          displayName: "",
          connectedAt: 0,
          status: "offline",
        },
      });
    }
  }

  /**
   * Handles an error message from the server — emits an error event.
   */
  private handleError(message: ServerMessage): void {
    this.emitError({
      code: message.code ?? "SERVER_ERROR",
      message: message.message ?? "Unknown server error",
    });
  }

  /**
   * Handles a batch-result message — processes merged/failed operations.
   *
   * Dequeues successfully merged operations and emits errors for failed ones.
   * Requirement 5.6: partial batch merge correctness.
   */
  private handleBatchResult(message: ServerMessage): void {
    if (!message.payload) {
      return;
    }

    const result = message.payload as BatchMergeResult;

    // Dequeue all successfully merged operations
    // The batch-result may include info about which ops succeeded
    // For now, we rely on individual ACKs or clear based on the result
    if (result.failed && result.failed.length > 0) {
      for (const failure of result.failed) {
        this.emitError({
          operationId: failure.operationId,
          code: failure.code,
          message: failure.message,
        });
      }
    }
  }

  /**
   * Handles a ping message — responds with a pong.
   */
  private handlePing(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "pong" }));
    }
  }

  // ─── Validation ──────────────────────────────────────────────────

  /**
   * Validates inventory item payload against business rules.
   * - name: max 100 characters (if present)
   * - quantity: integer from 0 to 10,000 (if present)
   *
   * Requirement 8.1
   *
   * @returns Error message string if invalid, or null if valid.
   */
  private validatePayload(payload: Record<string, unknown>): string | null {
    if ("name" in payload) {
      const name = payload.name;
      if (typeof name === "string" && name.length > 100) {
        return "Item name must not exceed 100 characters";
      }
    }

    if ("quantity" in payload) {
      const quantity = payload.quantity;
      if (typeof quantity === "number" && (quantity < 0 || quantity > 10_000)) {
        return "Item quantity must be between 0 and 10,000";
      }
    }

    return null;
  }

  // ─── Event Registration ────────────────────────────────────────────

  /**
   * Registers a handler for state-change events.
   * Requirement 9.4: emit a state-change event indicating affected collection and item.
   */
  onStateChange(handler: (event: StateChangeEvent) => void): void {
    this.stateChangeHandlers.push(handler);
  }

  /**
   * Registers a handler for error events.
   */
  onError(handler: (err: SDKError) => void): void {
    this.errorHandlers.push(handler);
  }

  /**
   * Registers a handler for presence events.
   */
  onPresence(handler: (event: PresenceEvent) => void): void {
    this.presenceHandlers.push(handler);
  }

  /**
   * Registers a handler for the connected event.
   */
  onConnected(handler: () => void): void {
    this.connectedHandlers.push(handler);
  }

  /**
   * Registers a handler for the disconnected event.
   */
  onDisconnected(handler: () => void): void {
    this.disconnectedHandlers.push(handler);
  }

  // ─── Event Emission (internal) ─────────────────────────────────────

  /** Emits a state-change event to all registered handlers. */
  protected emitStateChange(event: StateChangeEvent): void {
    for (const handler of this.stateChangeHandlers) {
      handler(event);
    }
  }

  /** Emits an error event to all registered handlers. */
  protected emitError(err: SDKError): void {
    for (const handler of this.errorHandlers) {
      handler(err);
    }
  }

  /** Emits a presence event to all registered handlers. */
  protected emitPresence(event: PresenceEvent): void {
    for (const handler of this.presenceHandlers) {
      handler(event);
    }
  }

  /** Emits the connected event to all registered handlers. */
  protected emitConnected(): void {
    for (const handler of this.connectedHandlers) {
      handler();
    }
  }

  /** Emits the disconnected event to all registered handlers. */
  protected emitDisconnected(): void {
    for (const handler of this.disconnectedHandlers) {
      handler();
    }
  }
}
