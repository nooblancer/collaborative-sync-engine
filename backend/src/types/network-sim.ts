/**
 * Network simulation type definitions for per-client condition injection.
 */

import type { CRDTOperation } from "./crdt.js";

/** SimulationState represents the current network conditions for a single client. */
export interface SimulationState {
  clientId: string;
  /** Simulated latency in milliseconds (0-5000). */
  latencyMs: number;
  /** When true, suppress all message delivery to this client. */
  disconnected: boolean;
  /** Partition group identifier for network partition simulation. */
  partitionGroup?: string;
  /** Operations queued during simulated disconnect. */
  queuedOperations: CRDTOperation[];
}

/** NetworkSimulator defines the interface for controlling per-client network conditions. */
export interface NetworkSimulator {
  setLatency(clientId: string, latencyMs: number): void;
  simulateDisconnect(clientId: string): void;
  /** Returns queued operations accumulated during the disconnect period. */
  simulateReconnect(clientId: string): CRDTOperation[];
  setPartition(groupA: string[], groupB: string[]): void;
  healPartition(): void;
  getState(clientId: string): SimulationState;
}
