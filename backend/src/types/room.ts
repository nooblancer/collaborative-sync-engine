/**
 * Room management type definitions for V2 multi-room architecture.
 */

import type { CRDTState, HLCTimestamp } from "./crdt.js";
import type { ConflictEvent } from "./conflict.js";

/** Room represents a collaborative session with participants and CRDT state. */
export interface Room {
  id: string;
  state: CRDTState;
  participants: Map<string, RoomParticipant>;
  operationCount: number;
  snapshotCount: number;
  conflictHistory: ConflictEvent[]; // Last 100
  createdAt: number;
}

/** RoomParticipant represents a user connected to a room. */
export interface RoomParticipant {
  clientId: string;
  userId: string;
  displayName: string;
  joinedAt: number;
  cursorPosition?: { x: number; y: number };
}

/** MultiplexedMessage is the envelope for channel-multiplexed communication. */
export interface MultiplexedMessage {
  channel: "ops" | "awareness" | "metrics" | "control";
  payload: unknown;
  roomId: string;
  messageId?: string;
}
