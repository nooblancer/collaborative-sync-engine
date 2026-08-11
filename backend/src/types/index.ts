/**
 * Barrel export file for all shared type definitions.
 */

export type {
  HLCTimestamp,
  LWWRegister,
  LWWElement,
  CRDTState,
  OperationType,
  CRDTOperation,
  StateDelta,
  ItemChange,
} from "./crdt.js";

export type {
  ConnectionState,
  WebSocketSession,
  UserPresence,
  SessionInfo,
} from "./connection.js";

export type { ClientMessage, ServerMessage } from "./protocol.js";

export type { Snapshot, PersistResult } from "./persistence.js";

export type {
  OperationError,
  MergeResult,
  BatchMergeResult,
} from "./results.js";

export type {
  StateChangeEvent,
  OperationResult,
  SDKError,
  PresenceEvent,
} from "./client.js";

export type {
  LWWRegister as LWWRegisterGeneric,
  AppendOnlySequence,
  FreehandPoint,
  CanvasObjectType,
  CanvasObjectCRDT,
  CanvasObject,
} from "./canvas.js";

export type { Room, RoomParticipant, MultiplexedMessage } from "./room.js";

export type { BatchProcessorConfig, BatchCycle } from "./batch.js";

export type { PerformanceMetrics, PerformanceCollector } from "./metrics.js";

export type { SimulationState, NetworkSimulator } from "./network-sim.js";

export type { SnapshotManagerConfig } from "./snapshot.js";

export type { ConflictEvent } from "./conflict.js";

export type {
  ClientSDKV2Config,
  ConnectionStateV2,
  ChannelSubscription,
  ChannelSubscriptionMap,
  AwarenessUpdate,
  ControlCommand,
  OfflineQueueConfig,
  OfflineQueueEntry,
  OfflineQueueState,
  ClientSDKV2,
} from "./client-sdk-v2.js";

export type {
  ChannelType,
  OperationPayload,
  AwarenessPayload,
  ControlPayload,
  ClientFrame,
  ServerFrame,
} from "./wire-protocol.js";
