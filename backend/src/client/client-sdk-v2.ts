/**
 * Client SDK V2 with channel multiplexing and offline queue.
 *
 * Implements a single WebSocket per room with four logical channels
 * (ops, awareness, metrics, control), a 100,000 operation offline queue
 * with local storage persistence, exponential backoff reconnection,
 * and ordered replay of queued operations on reconnection.
 *
 * Requirements: 19.1-19.5, 20.1-20.9
 */

import WebSocket from "ws";
import type {
  CRDTOperation,
  StateChangeEvent,
  ConflictEvent,
  PerformanceMetrics,
} from "../types/index.js";
import type {
  ClientSDKV2 as IClientSDKV2,
  ClientSDKV2Config,
  ConnectionStateV2,
  AwarenessUpdate,
  ControlCommand,
  OfflineQueueEntry,
  ChannelSubscription,
  ChannelSubscriptionMap,
} from "../types/client-sdk-v2.js";
import type {
  ChannelType,
  ClientFrame,
  ServerFrame,
  OperationPayload,
  AwarenessPayload,
  ControlPayload,
} from "../types/wire-protocol.js";

// ---------------------------------------------------------------------------
// Storage abstraction (works in Node.js and browser-like environments)
// ---------------------------------------------------------------------------

/**
 * Storage interface abstracting localStorage for offline queue persistence.
 * Falls back to an in-memory map when localStorage is unavailable (Node.js).
 */
interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory storage fallback for Node.js environments. */
class MemoryStorage implements StorageAdapter {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

/**
 * Resolves the appropriate storage backend.
 * Uses localStorage if available and functional (browser), otherwise in-memory (Node.js).
 */
function resolveStorage(): StorageAdapter {
  try {
    if (
      typeof globalThis !== "undefined" &&
      typeof globalThis.localStorage !== "undefined" &&
      globalThis.localStorage !== null
    ) {
      // Verify it actually works (some environments have localStorage but it throws)
      const testKey = "__storage_test__";
      globalThis.localStorage.setItem(testKey, "1");
      globalThis.localStorage.removeItem(testKey);
      return globalThis.localStorage as unknown as StorageAdapter;
    }
  } catch {
    // localStorage exists but is non-functional — fall through to memory
  }
  return new MemoryStorage();
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ClientSDKV2Config = {
  syncUrl: "",
  reconnectBaseMs: 100,
  reconnectMaxMs: 30_000,
  offlineQueueCapacity: 100_000,
  replayRatePerSecond: 5_000,
};

// ---------------------------------------------------------------------------
// ClientSDKV2 Implementation
// ---------------------------------------------------------------------------

/**
 * ClientSDKV2 provides channel-multiplexed WebSocket communication,
 * offline queue management, exponential backoff reconnection, and
 * ordered operation replay.
 */
export class ClientSDKV2Impl implements IClientSDKV2 {
  private readonly config: ClientSDKV2Config;
  private readonly storage: StorageAdapter;

  // Connection state
  private connectionState: ConnectionStateV2 = "disconnected";
  private ws: WebSocket | null = null;
  private roomId: string | null = null;
  private token: string | null = null;

  // Sequence counter for outgoing frames
  private seq = 0;

  // Channel subscriptions
  private channelSubscriptions: ChannelSubscriptionMap = {
    ops: { channel: "ops", active: true, subscribedAt: 0 },
    awareness: { channel: "awareness", active: true, subscribedAt: 0 },
    metrics: { channel: "metrics", active: false, subscribedAt: 0 },
    control: { channel: "control", active: true, subscribedAt: 0 },
  };

  // Offline queue
  private offlineQueue: OfflineQueueEntry[] = [];
  private nextSeq = 0;

  // Reconnection state
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;

  // Replay state
  private replayTimer: ReturnType<typeof setInterval> | null = null;

  // Event handlers
  private stateChangeHandlers: Array<(event: StateChangeEvent) => void> = [];
  private conflictHandlers: Array<(event: ConflictEvent) => void> = [];
  private metricsHandlers: Array<(metrics: PerformanceMetrics) => void> = [];
  private awarenessHandlers: Array<(update: AwarenessUpdate) => void> = [];
  private connectionStateHandlers: Array<(state: ConnectionStateV2) => void> = [];

  constructor(config: Partial<ClientSDKV2Config> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const storage = resolveStorage();
    this.storage = storage;
    this.restoreOfflineQueue();
  }

  // ─── Connection Lifecycle ────────────────────────────────────────────

  /**
   * Connect to a room with authentication token.
   * Establishes WebSocket and transitions to 'connected' state on success.
   */
  async connect(roomId: string, token: string): Promise<void> {
    this.roomId = roomId;
    this.token = token;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;

    return this.establishConnection();
  }

  /**
   * Disconnect from the current room.
   * Closes the WebSocket and cleans up timers.
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.clearReplayTimer();

    if (this.ws) {
      this.ws.close(1000, "client disconnect");
      this.ws = null;
    }

    this.setConnectionState("disconnected");
  }

  // ─── Channel Operations ──────────────────────────────────────────────

  /**
   * Send a CRDT operation on the ops channel.
   * If disconnected, the operation is queued in the offline queue.
   */
  sendOperation(operation: CRDTOperation): void {
    if (this.connectionState === "connected") {
      this.sendFrame("ops", this.operationToPayload(operation));
    } else {
      this.enqueueOffline(operation);
    }
  }

  /**
   * Send an awareness update on the awareness channel.
   * Awareness updates are fire-and-forget and NOT queued offline.
   */
  sendAwareness(data: AwarenessUpdate): void {
    if (this.connectionState === "connected") {
      const payload: AwarenessPayload = {
        clientId: data.clientId,
        cursor: data.cursor,
        selection: data.selection,
        displayName: data.displayName,
        color: data.color,
      };
      this.sendFrame("awareness", payload);
    }
    // Awareness updates are ephemeral — not queued when offline
  }

  /**
   * Send a control command on the control channel.
   */
  sendControl(command: ControlCommand): void {
    if (this.connectionState === "connected") {
      this.sendFrame("control", command as ControlPayload);
    }
  }

  // ─── Channel Subscriptions ───────────────────────────────────────────

  /**
   * Subscribe to a logical channel to start receiving messages.
   * Does NOT affect the WebSocket connection state.
   */
  subscribeChannel(channel: ChannelType): void {
    this.channelSubscriptions[channel] = {
      channel,
      active: true,
      subscribedAt: Date.now(),
    };

    // Notify server of subscription change via control channel
    if (this.connectionState === "connected") {
      this.sendFrame("control", {
        type: "subscribe-channel" as any,
        channel,
      } as any);
    }
  }

  /**
   * Unsubscribe from a logical channel without closing the WebSocket.
   * The underlying connection remains open.
   */
  unsubscribeChannel(channel: ChannelType): void {
    this.channelSubscriptions[channel] = {
      ...this.channelSubscriptions[channel],
      active: false,
    };

    // Notify server of unsubscription via control channel
    if (this.connectionState === "connected") {
      this.sendFrame("control", {
        type: "unsubscribe-channel" as any,
        channel,
      } as any);
    }
  }

  // ─── State Queries ───────────────────────────────────────────────────

  /**
   * Get the current connection state.
   */
  getConnectionState(): ConnectionStateV2 {
    return this.connectionState;
  }

  /**
   * Get the number of operations pending in the offline queue.
   */
  getOfflineQueueSize(): number {
    return this.offlineQueue.length;
  }

  // ─── Event Handlers ──────────────────────────────────────────────────

  onStateChange(handler: (event: StateChangeEvent) => void): void {
    this.stateChangeHandlers.push(handler);
  }

  onConflict(handler: (event: ConflictEvent) => void): void {
    this.conflictHandlers.push(handler);
  }

  onMetrics(handler: (metrics: PerformanceMetrics) => void): void {
    this.metricsHandlers.push(handler);
  }

  onAwareness(handler: (update: AwarenessUpdate) => void): void {
    this.awarenessHandlers.push(handler);
  }

  onConnectionStateChange(handler: (state: ConnectionStateV2) => void): void {
    this.connectionStateHandlers.push(handler);
  }

  // ─── Internal: Connection Management ─────────────────────────────────

  /**
   * Establishes the WebSocket connection.
   * Returns a promise that resolves on successful connection or rejects on failure.
   */
  private establishConnection(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.roomId || !this.token) {
        reject(new Error("Cannot connect: missing roomId or token"));
        return;
      }

      const url = `${this.config.syncUrl}?roomId=${encodeURIComponent(this.roomId)}&token=${encodeURIComponent(this.token)}`;

      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        reject(err);
        return;
      }

      this.ws.on("open", () => {
        this.reconnectAttempts = 0;
        this.clearReconnectTimer();

        // If we have queued operations, transition to replaying state
        if (this.offlineQueue.length > 0) {
          this.setConnectionState("replaying");
          this.startReplay().then(() => {
            this.setConnectionState("connected");
            resolve();
          });
        } else {
          this.setConnectionState("connected");
          resolve();
        }
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        this.handleServerFrame(data);
      });

      this.ws.on("close", (_code: number, _reason: Buffer) => {
        this.ws = null;

        if (this.shouldReconnect) {
          this.setConnectionState("reconnecting");
          this.scheduleReconnect();
        } else {
          this.setConnectionState("disconnected");
        }
      });

      this.ws.on("error", (err: Error) => {
        if (this.connectionState === "disconnected" || this.connectionState === "reconnecting") {
          // Connection attempt failed
          this.ws = null;
          if (!this.shouldReconnect) {
            reject(err);
          }
          // If shouldReconnect is true, the close handler will schedule retry
        }
      });
    });
  }

  // ─── Internal: Reconnection with Exponential Backoff ─────────────────

  /**
   * Schedules a reconnection attempt with exponential backoff.
   * Delay = min(baseMs * 2^attempts, maxMs)
   */
  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    const delay = this.computeBackoff();
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      if (!this.shouldReconnect) return;

      try {
        await this.establishConnection();
      } catch {
        // establishConnection will trigger close → scheduleReconnect
        // unless shouldReconnect was set to false
      }
    }, delay);
  }

  /**
   * Computes the exponential backoff delay for the current attempt.
   * Formula: min(reconnectBaseMs * 2^attempts, reconnectMaxMs)
   */
  computeBackoff(): number {
    const delay = Math.min(
      this.config.reconnectBaseMs * Math.pow(2, this.reconnectAttempts),
      this.config.reconnectMaxMs
    );
    return delay;
  }

  /**
   * Returns the current reconnect attempt count (for testing).
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ─── Internal: Offline Queue ─────────────────────────────────────────

  /**
   * Enqueues an operation in the offline queue.
   * Rejects with 'queue_full' error if at capacity.
   */
  private enqueueOffline(operation: CRDTOperation): void {
    if (this.offlineQueue.length >= this.config.offlineQueueCapacity) {
      // Emit error - queue is full (Requirement 19.4)
      throw new Error("queue_full");
    }

    const entry: OfflineQueueEntry = {
      operation,
      enqueuedAt: Date.now(),
      seq: this.nextSeq++,
    };

    this.offlineQueue.push(entry);
    this.persistOfflineQueue();
  }

  /**
   * Persists the offline queue to storage for page-refresh survival.
   * Uses JSON serialization (Requirement 19.3).
   */
  private persistOfflineQueue(): void {
    const key = this.getStorageKey();
    const data = JSON.stringify({
      entries: this.offlineQueue,
      nextSeq: this.nextSeq,
    });
    this.storage.setItem(key, data);
  }

  /**
   * Restores the offline queue from storage on construction.
   */
  private restoreOfflineQueue(): void {
    const key = this.getStorageKey();
    const raw = this.storage.getItem(key);
    if (!raw) return;

    try {
      const data = JSON.parse(raw) as { entries: OfflineQueueEntry[]; nextSeq: number };
      this.offlineQueue = data.entries || [];
      this.nextSeq = data.nextSeq || 0;
    } catch {
      // Corrupted storage — start fresh
      this.offlineQueue = [];
      this.nextSeq = 0;
    }
  }

  /**
   * Returns the storage key for the offline queue.
   */
  private getStorageKey(): string {
    return `sync-sdk-v2-queue-${this.roomId ?? "default"}`;
  }

  // ─── Internal: Operation Replay ──────────────────────────────────────

  /**
   * Replays queued operations at the configured rate (5,000 ops/sec default).
   * Operations are sent in causal (seq) order.
   */
  private startReplay(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.offlineQueue.length === 0) {
        resolve();
        return;
      }

      // Sort by seq to ensure causal ordering (Requirement 19.5)
      this.offlineQueue.sort((a, b) => a.seq - b.seq);

      const opsPerInterval = Math.ceil(this.config.replayRatePerSecond / 20);
      const intervalMs = 50; // 20 intervals per second

      this.replayTimer = setInterval(() => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          this.clearReplayTimer();
          resolve();
          return;
        }

        const batch = this.offlineQueue.splice(0, opsPerInterval);
        if (batch.length === 0) {
          this.clearReplayTimer();
          this.persistOfflineQueue();
          resolve();
          return;
        }

        for (const entry of batch) {
          this.sendFrame("ops", this.operationToPayload(entry.operation));
        }

        // Persist remaining queue state
        this.persistOfflineQueue();
      }, intervalMs);
    });
  }

  private clearReplayTimer(): void {
    if (this.replayTimer !== null) {
      clearInterval(this.replayTimer);
      this.replayTimer = null;
    }
  }

  // ─── Internal: Frame Sending ─────────────────────────────────────────

  /**
   * Sends a ClientFrame on the WebSocket as JSON.
   */
  private sendFrame(
    channel: ChannelType,
    payload: OperationPayload | AwarenessPayload | ControlPayload
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.roomId) return;

    const frame: ClientFrame = {
      channel,
      roomId: this.roomId,
      seq: this.seq++,
      payload,
    };

    this.ws.send(JSON.stringify(frame));
  }

  /**
   * Converts a CRDTOperation to the wire OperationPayload format.
   */
  private operationToPayload(operation: CRDTOperation): OperationPayload {
    return {
      id: operation.id,
      type: operation.type,
      itemId: operation.itemId,
      payload: operation.payload,
      timestamp: {
        wallTime: operation.timestamp.wallTime,
        logical: operation.timestamp.logical,
        nodeId: operation.timestamp.nodeId,
      },
      version: operation.version,
    };
  }

  // ─── Internal: Server Frame Handling ─────────────────────────────────

  /**
   * Handles an incoming ServerFrame from the WebSocket.
   * Routes to appropriate handler based on channel and type.
   */
  private handleServerFrame(data: WebSocket.Data): void {
    let frame: ServerFrame;
    try {
      frame = JSON.parse(data.toString()) as ServerFrame;
    } catch {
      // Ignore unparseable messages
      return;
    }

    // Only process messages for subscribed channels
    if (!this.channelSubscriptions[frame.channel]?.active) {
      return;
    }

    switch (frame.channel) {
      case "ops":
        this.handleOpsFrame(frame);
        break;
      case "awareness":
        this.handleAwarenessFrame(frame);
        break;
      case "metrics":
        this.handleMetricsFrame(frame);
        break;
      case "control":
        this.handleControlFrame(frame);
        break;
    }
  }

  /**
   * Handles an ops channel frame (ack, delta, conflict).
   */
  private handleOpsFrame(frame: ServerFrame): void {
    switch (frame.type) {
      case "ack":
        // ACK for sent operation — no action needed for now
        break;
      case "delta": {
        const event = frame.payload as StateChangeEvent;
        for (const handler of this.stateChangeHandlers) {
          handler(event);
        }
        break;
      }
      case "conflict": {
        const conflict = frame.payload as ConflictEvent;
        for (const handler of this.conflictHandlers) {
          handler(conflict);
        }
        break;
      }
    }
  }

  /**
   * Handles an awareness channel frame.
   */
  private handleAwarenessFrame(frame: ServerFrame): void {
    if (frame.type === "awareness-update") {
      const update = frame.payload as AwarenessUpdate;
      for (const handler of this.awarenessHandlers) {
        handler(update);
      }
    }
  }

  /**
   * Handles a metrics channel frame.
   */
  private handleMetricsFrame(frame: ServerFrame): void {
    if (frame.type === "metrics-snapshot") {
      const metrics = frame.payload as PerformanceMetrics;
      for (const handler of this.metricsHandlers) {
        handler(metrics);
      }
    }
  }

  /**
   * Handles a control channel frame (responses, errors, presence).
   */
  private handleControlFrame(frame: ServerFrame): void {
    switch (frame.type) {
      case "control-response":
        // Control responses can be handled by the application
        break;
      case "error":
        // Could emit to a generic error handler in future
        break;
      case "presence-join":
      case "presence-leave":
        // Presence events — could be exposed via dedicated handler
        break;
    }
  }

  // ─── Internal: Connection State Machine ──────────────────────────────

  /**
   * Transitions the connection state and notifies handlers.
   * Valid transitions:
   *   disconnected → reconnecting (on auto-reconnect)
   *   reconnecting → connected (successful reconnection with empty queue)
   *   reconnecting → replaying (successful reconnection with queued ops)
   *   replaying → connected (replay complete)
   *   connected → disconnected (manual disconnect or fatal)
   *   connected → reconnecting (unexpected close with shouldReconnect)
   */
  private setConnectionState(newState: ConnectionStateV2): void {
    if (this.connectionState === newState) return;
    this.connectionState = newState;
    for (const handler of this.connectionStateHandlers) {
      handler(newState);
    }
  }

  // ─── Testing Helpers (package-internal) ──────────────────────────────

  /**
   * Exposes the offline queue entries for testing purposes.
   */
  getOfflineQueue(): OfflineQueueEntry[] {
    return [...this.offlineQueue];
  }

  /**
   * Exposes channel subscriptions for testing purposes.
   */
  getChannelSubscriptions(): ChannelSubscriptionMap {
    return { ...this.channelSubscriptions };
  }

  /**
   * Allows injection of a custom storage adapter (for testing).
   */
  static createWithStorage(
    config: Partial<ClientSDKV2Config>,
    storage: StorageAdapter
  ): ClientSDKV2Impl {
    const instance = new ClientSDKV2Impl(config);
    (instance as any).storage = storage;
    return instance;
  }

  /**
   * Directly enqueue an operation for offline testing.
   */
  enqueueForTest(operation: CRDTOperation): void {
    this.enqueueOffline(operation);
  }

  /**
   * Force set connection state for testing.
   */
  setConnectionStateForTest(state: ConnectionStateV2): void {
    this.setConnectionState(state);
  }

  /**
   * Get the raw storage adapter for testing persistence.
   */
  getStorage(): StorageAdapter {
    return this.storage;
  }

  /**
   * Set the room ID for testing queue persistence keys.
   */
  setRoomIdForTest(roomId: string): void {
    this.roomId = roomId;
  }
}
