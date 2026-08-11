/**
 * Network Simulator module for per-client network condition injection.
 *
 * Provides latency injection, simulated disconnects with operation queuing,
 * simulated reconnects with causal-order delivery, network partitioning,
 * and partition healing — all on a per-client basis without affecting
 * other room members.
 *
 * Requirements: 4.1-4.6
 */

import type { CRDTOperation } from "../types/crdt.js";
import type {
  NetworkSimulator,
  SimulationState,
} from "../types/network-sim.js";
import { compareTimestamps } from "./hlc.js";

/** Maximum allowed latency in milliseconds. */
const MAX_LATENCY_MS = 5000;

/** Minimum allowed latency in milliseconds. */
const MIN_LATENCY_MS = 0;

/**
 * Creates a default SimulationState for a client with no simulation active.
 */
function createDefaultState(clientId: string): SimulationState {
  return {
    clientId,
    latencyMs: 0,
    disconnected: false,
    partitionGroup: undefined,
    queuedOperations: [],
  };
}

/**
 * NetworkSimulatorImpl implements per-client network condition simulation.
 *
 * - Latency injection (0-5000ms) on outbound messages
 * - Simulated disconnect: suppress delivery, queue operations server-side
 * - Simulated reconnect: deliver queued operations in causal (HLC) order
 * - Partition simulation: prevent cross-group delivery, allow intra-group
 * - Partition healing: clear partition groups to trigger CRDT merge of diverged states
 * - All conditions are per-client without affecting other room members
 */
export class NetworkSimulatorImpl implements NetworkSimulator {
  private states: Map<string, SimulationState> = new Map();

  /**
   * Sets the simulated latency for a specific client.
   * Value is clamped to the range [0, 5000] ms.
   *
   * Requirement 4.1: Inject specified delay on all outbound messages to that client.
   */
  setLatency(clientId: string, latencyMs: number): void {
    const state = this.getOrCreateState(clientId);
    state.latencyMs = Math.max(MIN_LATENCY_MS, Math.min(MAX_LATENCY_MS, latencyMs));
  }

  /**
   * Simulates a disconnect for a specific client.
   * All operations destined for the client will be queued until reconnection.
   *
   * Requirement 4.2: Suppress all message delivery, maintain server-side state, queue operations.
   */
  simulateDisconnect(clientId: string): void {
    const state = this.getOrCreateState(clientId);
    state.disconnected = true;
  }

  /**
   * Simulates a reconnect for a previously disconnected client.
   * Returns all queued operations in causal (HLC timestamp) order and clears the queue.
   *
   * Requirement 4.3: Deliver all queued operations in causal order on reconnection.
   */
  simulateReconnect(clientId: string): CRDTOperation[] {
    const state = this.getOrCreateState(clientId);
    state.disconnected = false;

    // Sort queued operations by HLC timestamp for causal ordering
    const queued = state.queuedOperations.sort((a, b) =>
      compareTimestamps(a.timestamp, b.timestamp)
    );

    // Clear the queue and return the sorted operations
    state.queuedOperations = [];
    return queued;
  }

  /**
   * Establishes a network partition between two groups of clients.
   * Clients in groupA get partitionGroup="A", clients in groupB get partitionGroup="B".
   * Cross-group delivery is prevented while intra-group communication continues.
   *
   * Requirement 4.4: Prevent message delivery between groups, allow intra-group communication.
   */
  setPartition(groupA: string[], groupB: string[]): void {
    for (const clientId of groupA) {
      const state = this.getOrCreateState(clientId);
      state.partitionGroup = "A";
    }
    for (const clientId of groupB) {
      const state = this.getOrCreateState(clientId);
      state.partitionGroup = "B";
    }
  }

  /**
   * Heals the network partition by clearing all partition group assignments.
   * After healing, the Sync_Engine should merge diverged states to achieve convergence.
   *
   * Requirement 4.5: Merge diverged states and achieve convergence after partition healing.
   */
  healPartition(): void {
    for (const state of this.states.values()) {
      state.partitionGroup = undefined;
    }
  }

  /**
   * Returns the current simulation state for a client.
   * If no state exists, returns a default (no simulation active).
   */
  getState(clientId: string): SimulationState {
    return this.getOrCreateState(clientId);
  }

  /**
   * Determines whether a message from one client should be delivered to another.
   * Used by the ConnectionManager to check delivery conditions.
   *
   * Returns false if:
   * - The target client is in a simulated disconnect state
   * - The source and target are in different partition groups
   *
   * Requirement 4.2, 4.4, 4.6: Per-client conditions without affecting others.
   */
  shouldDeliver(fromClientId: string, toClientId: string): boolean {
    const toState = this.getOrCreateState(toClientId);

    // If target is disconnected, suppress delivery
    if (toState.disconnected) {
      return false;
    }

    // Check partition groups
    const fromState = this.getOrCreateState(fromClientId);

    // If both clients have partition groups assigned and they differ, block delivery
    if (
      fromState.partitionGroup !== undefined &&
      toState.partitionGroup !== undefined &&
      fromState.partitionGroup !== toState.partitionGroup
    ) {
      return false;
    }

    return true;
  }

  /**
   * Returns the delivery delay (latency) for a specific client.
   * Used by the ConnectionManager to inject latency on outbound messages.
   *
   * Requirement 4.1: Inject specified delay on outbound messages.
   */
  getDeliveryDelay(clientId: string): number {
    const state = this.getOrCreateState(clientId);
    return state.latencyMs;
  }

  /**
   * Queues an operation for a disconnected client.
   * Operations are stored until the client reconnects.
   *
   * Requirement 4.2: Queue operations during simulated disconnect.
   */
  queueOperation(clientId: string, operation: CRDTOperation): void {
    const state = this.getOrCreateState(clientId);
    state.queuedOperations.push(operation);
  }

  /**
   * Removes all simulation state for a client (cleanup on actual disconnect).
   */
  removeClient(clientId: string): void {
    this.states.delete(clientId);
  }

  /**
   * Resets all simulation state (useful for testing).
   */
  reset(): void {
    this.states.clear();
  }

  /**
   * Gets or creates the simulation state for a client.
   */
  private getOrCreateState(clientId: string): SimulationState {
    let state = this.states.get(clientId);
    if (!state) {
      state = createDefaultState(clientId);
      this.states.set(clientId, state);
    }
    return state;
  }
}
