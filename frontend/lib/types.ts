// --- Server → Client messages ---

export type ServerMessage =
  | { type: "ack"; operationId: string }
  | { type: "delta"; payload: StateDelta }
  | { type: "presence-list"; users: UserPresence[] }
  | { type: "presence-join"; user: UserPresence }
  | { type: "presence-leave"; userId: string }
  | { type: "ping" }
  | { type: "error"; code: string; message: string };

// --- Client → Server messages ---

export type ClientMessage =
  | { type: "operation"; payload: CRDTOperation }
  | { type: "presence-request" }
  | { type: "pong" };

// --- Domain models ---

export interface InventoryItem {
  itemId: string;
  name: string; // 1-100 characters
  quantity: number; // 0-10,000
  removedAt: number | null;
  lastUpdatedBy: string; // displayName of last updater
}

export interface UserPresence {
  userId: string;
  displayName: string;
}

export interface EventLogEntry {
  id: string;
  timestamp: Date;
  message: string;
  type: "info" | "error" | "general";
}

// --- Delta / sync types ---

export interface StateDelta {
  changes: ItemChange[];
}

export interface ItemChange {
  type: "added" | "updated" | "removed";
  itemId: string;
  name?: string;
  quantity?: number;
  removedAt?: number | null;
  lastUpdatedBy?: string;
}

export interface CRDTOperation {
  operationId: string;
  type: "add" | "update" | "remove";
  itemId: string;
  payload?: {
    name?: string;
    quantity?: number;
  };
}
