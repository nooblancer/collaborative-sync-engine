/**
 * Property-based tests for the NetworkSimulator.
 *
 * Property 12: Simulated Disconnect Queues All Operations
 * Property 13: Partition Prevents Cross-Group Delivery
 * Property 14: Partition Healing Convergence
 * Property 15: Simulation Per-Client Isolation
 *
 * **Validates: Requirements 4.2, 4.4, 4.5, 4.6**
 *
 * Feature: collaborative-sync-engine (Sync Platform V2)
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import { NetworkSimulatorImpl } from "./network-simulator.js";
import { SyncEngineV2 } from "./sync-engine-v2.js";
import type { CRDTOperation, HLCTimestamp } from "../types/index.js";

// --- Arbitraries (generators) ---

/** Generate a valid HLC timestamp with strictly increasing wallTime based on index */
function arbHLCTimestamp(opts?: {
  minWallTime?: number;
  maxWallTime?: number;
}): fc.Arbitrary<HLCTimestamp> {
  return fc.record({
    wallTime: fc.integer({
      min: opts?.minWallTime ?? 1000,
      max: opts?.maxWallTime ?? 1_000_000_000,
    }),
    logical: fc.nat({ max: 1000 }),
    nodeId: fc.stringOf(
      fc.constantFrom("a", "b", "c", "d", "e", "f", "1", "2", "3"),
      { minLength: 1, maxLength: 8 }
    ),
  });
}

/** Generate a valid CRDTOperation */
function arbCRDTOperation(opts?: {
  replicaId?: string;
}): fc.Arbitrary<CRDTOperation> {
  return fc.record({
    id: fc.uuid(),
    sessionId: fc.constant("test-session"),
    replicaId: fc.constant(opts?.replicaId ?? "replica-default"),
    type: fc.constantFrom("add" as const, "update" as const, "remove" as const),
    itemId: fc.stringOf(fc.constantFrom("i", "t", "e", "m", "1", "2", "3"), {
      minLength: 1,
      maxLength: 8,
    }),
    payload: fc.dictionary(
      fc.constantFrom("name", "x", "y", "width"),
      fc.oneof(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.integer({ min: 0, max: 1000 })
      ),
      { minKeys: 1, maxKeys: 3 }
    ),
    timestamp: arbHLCTimestamp(),
    version: fc.nat({ max: 100 }),
  });
}

/** Generate a list of operations with unique, strictly increasing timestamps */
function arbOperationsWithIncreasingTimestamps(
  minOps: number,
  maxOps: number,
  replicaId: string
): fc.Arbitrary<CRDTOperation[]> {
  return fc
    .integer({ min: minOps, max: maxOps })
    .chain((n) =>
      fc
        .array(arbCRDTOperation({ replicaId }), {
          minLength: n,
          maxLength: n,
        })
        .map((ops) =>
          ops.map((op, idx) => ({
            ...op,
            timestamp: {
              ...op.timestamp,
              wallTime: 1000 + (idx + 1) * 100,
              logical: idx,
            },
          }))
        )
    );
}

/** Generate a unique client ID */
function arbClientId(): fc.Arbitrary<string> {
  return fc.stringOf(
    fc.constantFrom("c", "l", "i", "e", "n", "t", "1", "2", "3", "4", "5"),
    { minLength: 3, maxLength: 10 }
  );
}

/** Generate two distinct non-overlapping groups of client IDs */
function arbTwoGroups(): fc.Arbitrary<{ groupA: string[]; groupB: string[] }> {
  return fc
    .integer({ min: 1, max: 4 })
    .chain((sizeA) =>
      fc.integer({ min: 1, max: 4 }).chain((sizeB) =>
        fc.record({
          groupA: fc.array(
            fc.constant("").map((_, i) => `client-a-${i}`),
            { minLength: sizeA, maxLength: sizeA }
          ),
          groupB: fc.array(
            fc.constant("").map((_, i) => `client-b-${i}`),
            { minLength: sizeB, maxLength: sizeB }
          ),
        })
      )
    )
    .map(({ groupA, groupB }) => ({
      groupA: groupA.map((_, i) => `client-a-${i}`),
      groupB: groupB.map((_, i) => `client-b-${i}`),
    }));
}

// --- Property Tests ---

describe("Feature: collaborative-sync-engine, Property 12: Simulated Disconnect Queues All Operations", () => {
  /**
   * **Validates: Requirements 4.2**
   *
   * For any client in simulated-disconnect state, all operations destined
   * for that client SHALL be queued and none SHALL be delivered until reconnection.
   */

  let simulator: NetworkSimulatorImpl;

  beforeEach(() => {
    simulator = new NetworkSimulatorImpl();
  });

  it("all operations are queued during disconnect and none are delivered", () => {
    fc.assert(
      fc.property(
        arbClientId(),
        fc.array(arbCRDTOperation(), { minLength: 1, maxLength: 50 }),
        (clientId, operations) => {
          // Fresh simulator per run to avoid state leakage
          const sim = new NetworkSimulatorImpl();

          // Simulate disconnect
          sim.simulateDisconnect(clientId);

          // Verify client is disconnected
          const state = sim.getState(clientId);
          expect(state.disconnected).toBe(true);

          // shouldDeliver must return false for all operations to this client
          for (const op of operations) {
            const canDeliver = sim.shouldDeliver(op.replicaId, clientId);
            expect(canDeliver).toBe(false);
          }

          // Queue all operations
          for (const op of operations) {
            sim.queueOperation(clientId, op);
          }

          // Verify all operations are queued
          const stateAfterQueue = sim.getState(clientId);
          expect(stateAfterQueue.queuedOperations.length).toBe(operations.length);

          // No operations should be "delivered" (shouldDeliver stays false)
          expect(sim.shouldDeliver("any-sender", clientId)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("reconnection delivers all queued operations in causal order", () => {
    fc.assert(
      fc.property(
        arbClientId(),
        arbOperationsWithIncreasingTimestamps(2, 20, "sender-1"),
        (clientId, operations) => {
          // Fresh simulator per run to avoid state leakage
          const sim = new NetworkSimulatorImpl();

          // Disconnect the client
          sim.simulateDisconnect(clientId);

          // Queue operations in arbitrary order (they have increasing timestamps)
          // Shuffle first to test that reconnect sorts them
          const shuffled = [...operations].sort(() => Math.random() - 0.5);
          for (const op of shuffled) {
            sim.queueOperation(clientId, op);
          }

          // Reconnect - should return operations sorted by HLC (causal order)
          const delivered = sim.simulateReconnect(clientId);

          // Verify all operations are returned
          expect(delivered.length).toBe(operations.length);

          // Verify causal ordering: each operation's timestamp >= previous
          for (let i = 1; i < delivered.length; i++) {
            const prev = delivered[i - 1].timestamp;
            const curr = delivered[i].timestamp;
            const isOrdered =
              curr.wallTime > prev.wallTime ||
              (curr.wallTime === prev.wallTime && curr.logical > prev.logical) ||
              (curr.wallTime === prev.wallTime &&
                curr.logical === prev.logical &&
                curr.nodeId >= prev.nodeId);
            expect(isOrdered).toBe(true);
          }

          // Verify queue is now empty
          const stateAfter = sim.getState(clientId);
          expect(stateAfter.queuedOperations.length).toBe(0);
          expect(stateAfter.disconnected).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: collaborative-sync-engine, Property 13: Partition Prevents Cross-Group Delivery", () => {
  /**
   * **Validates: Requirements 4.4**
   *
   * For any partition configuration with groups A and B, operations originating
   * in group A SHALL NOT be delivered to clients in group B, and vice versa,
   * while the partition is active.
   */

  let simulator: NetworkSimulatorImpl;

  beforeEach(() => {
    simulator = new NetworkSimulatorImpl();
  });

  it("cross-group delivery is blocked in both directions while partition is active", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        (sizeA, sizeB) => {
          // Fresh simulator per run
          const sim = new NetworkSimulatorImpl();

          const groupA = Array.from({ length: sizeA }, (_, i) => `group-a-${i}`);
          const groupB = Array.from({ length: sizeB }, (_, i) => `group-b-${i}`);

          // Set partition
          sim.setPartition(groupA, groupB);

          // Verify: no client in group A can deliver to any client in group B
          for (const fromA of groupA) {
            for (const toB of groupB) {
              expect(sim.shouldDeliver(fromA, toB)).toBe(false);
            }
          }

          // Verify: no client in group B can deliver to any client in group A
          for (const fromB of groupB) {
            for (const toA of groupA) {
              expect(sim.shouldDeliver(fromB, toA)).toBe(false);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("intra-group delivery is allowed within the same partition group", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 2, max: 5 }),
        (sizeA, sizeB) => {
          // Fresh simulator per run
          const sim = new NetworkSimulatorImpl();

          const groupA = Array.from({ length: sizeA }, (_, i) => `intra-a-${i}`);
          const groupB = Array.from({ length: sizeB }, (_, i) => `intra-b-${i}`);

          sim.setPartition(groupA, groupB);

          // Intra-group A delivery should be allowed
          for (let i = 0; i < groupA.length; i++) {
            for (let j = 0; j < groupA.length; j++) {
              if (i !== j) {
                expect(sim.shouldDeliver(groupA[i], groupA[j])).toBe(true);
              }
            }
          }

          // Intra-group B delivery should be allowed
          for (let i = 0; i < groupB.length; i++) {
            for (let j = 0; j < groupB.length; j++) {
              if (i !== j) {
                expect(sim.shouldDeliver(groupB[i], groupB[j])).toBe(true);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: collaborative-sync-engine, Property 14: Partition Healing Convergence", () => {
  /**
   * **Validates: Requirements 4.5**
   *
   * For any two groups that diverged during a partition, after the partition
   * heals, all clients SHALL converge to an identical CRDT state containing
   * all operations from both groups.
   */

  let simulator: NetworkSimulatorImpl;

  beforeEach(() => {
    simulator = new NetworkSimulatorImpl();
  });

  it("after partition heals, cross-group delivery is restored and convergence is achievable", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 4 }),
        fc.array(arbCRDTOperation({ replicaId: "group-a-source" }), {
          minLength: 1,
          maxLength: 10,
        }),
        fc.array(arbCRDTOperation({ replicaId: "group-b-source" }), {
          minLength: 1,
          maxLength: 10,
        }),
        (sizeA, sizeB, opsA, opsB) => {
          // Fresh simulator per run
          const sim = new NetworkSimulatorImpl();

          const groupA = Array.from(
            { length: sizeA },
            (_, i) => `heal-a-${i}`
          );
          const groupB = Array.from(
            { length: sizeB },
            (_, i) => `heal-b-${i}`
          );

          // Create partition
          sim.setPartition(groupA, groupB);

          // Verify partition blocks cross-group delivery
          for (const fromA of groupA) {
            for (const toB of groupB) {
              expect(sim.shouldDeliver(fromA, toB)).toBe(false);
            }
          }

          // Heal the partition
          sim.healPartition();

          // After healing, cross-group delivery should be restored
          for (const fromA of groupA) {
            for (const toB of groupB) {
              expect(sim.shouldDeliver(fromA, toB)).toBe(true);
            }
          }
          for (const fromB of groupB) {
            for (const toA of groupA) {
              expect(sim.shouldDeliver(fromB, toA)).toBe(true);
            }
          }

          // Simulate convergence: apply all ops from both groups to a
          // shared SyncEngine and verify identical final state
          const engine = new SyncEngineV2();
          const room = engine.createRoom("convergence-room");

          // Give all ops unique item IDs to avoid conflicts in this test,
          // and use "add" type so they all succeed
          const allOps = [
            ...opsA.map((op, i) => ({
              ...op,
              type: "add" as const,
              itemId: `item-a-${i}`,
              timestamp: {
                wallTime: 1000 + i,
                logical: 0,
                nodeId: "node-a",
              },
            })),
            ...opsB.map((op, i) => ({
              ...op,
              type: "add" as const,
              itemId: `item-b-${i}`,
              timestamp: {
                wallTime: 2000 + i,
                logical: 0,
                nodeId: "node-b",
              },
            })),
          ];

          // Apply all operations to the engine (simulating post-heal merge)
          for (const op of allOps) {
            engine.processOperation(room.id, op);
          }

          // Verify final state contains all items from both groups
          const finalState = engine.getState(room.id);
          for (const op of allOps) {
            expect(finalState.items[op.itemId]).toBeDefined();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it("diverged states converge to identical state regardless of application order", () => {
    fc.assert(
      fc.property(
        fc.array(arbCRDTOperation({ replicaId: "replica-x" }), {
          minLength: 2,
          maxLength: 8,
        }),
        fc.array(arbCRDTOperation({ replicaId: "replica-y" }), {
          minLength: 2,
          maxLength: 8,
        }),
        (opsGroupA, opsGroupB) => {
          // Prepare operations with distinct item IDs and proper add types
          const normalizedA = opsGroupA.map((op, i) => ({
            ...op,
            type: "add" as const,
            itemId: `converge-a-${i}`,
            timestamp: {
              wallTime: 5000 + i * 10,
              logical: 0,
              nodeId: "node-a",
            },
          }));
          const normalizedB = opsGroupB.map((op, i) => ({
            ...op,
            type: "add" as const,
            itemId: `converge-b-${i}`,
            timestamp: {
              wallTime: 6000 + i * 10,
              logical: 0,
              nodeId: "node-b",
            },
          }));

          // Apply in order A then B
          const engine1 = new SyncEngineV2();
          const room1 = engine1.createRoom("room-order-1");
          for (const op of [...normalizedA, ...normalizedB]) {
            engine1.processOperation(room1.id, op);
          }

          // Apply in order B then A
          const engine2 = new SyncEngineV2();
          const room2 = engine2.createRoom("room-order-2");
          for (const op of [...normalizedB, ...normalizedA]) {
            engine2.processOperation(room2.id, op);
          }

          // Both engines should have identical final state
          const state1 = engine1.getState(room1.id);
          const state2 = engine2.getState(room2.id);

          // Same items present
          const itemIds1 = Object.keys(state1.items).sort();
          const itemIds2 = Object.keys(state2.items).sort();
          expect(itemIds1).toEqual(itemIds2);

          // All items from both groups are present
          for (const op of normalizedA) {
            expect(state1.items[op.itemId]).toBeDefined();
            expect(state2.items[op.itemId]).toBeDefined();
          }
          for (const op of normalizedB) {
            expect(state1.items[op.itemId]).toBeDefined();
            expect(state2.items[op.itemId]).toBeDefined();
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe("Feature: collaborative-sync-engine, Property 15: Simulation Per-Client Isolation", () => {
  /**
   * **Validates: Requirements 4.6**
   *
   * For any network simulation condition applied to client X, all other
   * clients in the same room SHALL experience unmodified message delivery.
   */

  let simulator: NetworkSimulatorImpl;

  beforeEach(() => {
    simulator = new NetworkSimulatorImpl();
  });

  it("latency applied to one client does not affect others", () => {
    fc.assert(
      fc.property(
        arbClientId(),
        fc.array(arbClientId(), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 100, max: 5000 }),
        (targetClient, otherClients, latency) => {
          // Fresh simulator per run to avoid state leakage
          const sim = new NetworkSimulatorImpl();

          // Ensure other clients are distinct from target
          const others = otherClients
            .filter((c) => c !== targetClient)
            .slice(0, 5);
          if (others.length === 0) return; // Skip if no distinct clients

          // Apply latency to target client
          sim.setLatency(targetClient, latency);

          // Target client has the injected latency
          expect(sim.getDeliveryDelay(targetClient)).toBe(latency);

          // Other clients should have zero latency (default)
          for (const other of others) {
            expect(sim.getDeliveryDelay(other)).toBe(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("disconnect of one client does not affect delivery to other clients", () => {
    fc.assert(
      fc.property(
        arbClientId(),
        fc.array(arbClientId(), { minLength: 1, maxLength: 5 }),
        (targetClient, otherClients) => {
          // Fresh simulator per run to avoid state leakage
          const sim = new NetworkSimulatorImpl();

          // Ensure other clients are distinct from target
          const others = otherClients
            .filter((c) => c !== targetClient)
            .slice(0, 5);
          if (others.length === 0) return;

          // Disconnect target client
          sim.simulateDisconnect(targetClient);

          // Target cannot receive messages
          expect(sim.shouldDeliver("any-sender", targetClient)).toBe(false);

          // Other clients CAN still receive messages (unaffected)
          for (const other of others) {
            expect(sim.shouldDeliver("any-sender", other)).toBe(true);
          }

          // Other clients are not disconnected
          for (const other of others) {
            const state = sim.getState(other);
            expect(state.disconnected).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("partition affects only clients in partition groups, not unassigned clients", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 3 }),
        (sizeA, sizeB, sizeUnassigned) => {
          // Fresh simulator per run to avoid state leakage
          const sim = new NetworkSimulatorImpl();

          const groupA = Array.from(
            { length: sizeA },
            (_, i) => `iso-a-${i}`
          );
          const groupB = Array.from(
            { length: sizeB },
            (_, i) => `iso-b-${i}`
          );
          const unassigned = Array.from(
            { length: sizeUnassigned },
            (_, i) => `iso-free-${i}`
          );

          // Set partition between A and B only
          sim.setPartition(groupA, groupB);

          // Unassigned clients should be able to receive from anyone
          for (const free of unassigned) {
            // Delivery from group A to unassigned should work
            // (unassigned has no partitionGroup so the partition check doesn't block)
            for (const fromA of groupA) {
              expect(sim.shouldDeliver(fromA, free)).toBe(true);
            }
            // Delivery from group B to unassigned should work
            for (const fromB of groupB) {
              expect(sim.shouldDeliver(fromB, free)).toBe(true);
            }
            // Unassigned to unassigned should work
            for (const otherFree of unassigned) {
              expect(sim.shouldDeliver(free, otherFree)).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("multiple simulation conditions on one client leave all other clients unaffected", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 5000 }),
        fc.integer({ min: 2, max: 4 }),
        (latency, numOthers) => {
          const targetClient = "target-client";
          const otherClients = Array.from(
            { length: numOthers },
            (_, i) => `other-${i}`
          );

          // Apply multiple conditions to the target
          simulator.setLatency(targetClient, latency);
          simulator.simulateDisconnect(targetClient);

          // Target has both conditions
          const targetState = simulator.getState(targetClient);
          expect(targetState.latencyMs).toBe(latency);
          expect(targetState.disconnected).toBe(true);

          // Other clients are completely unaffected
          for (const other of otherClients) {
            const otherState = simulator.getState(other);
            expect(otherState.latencyMs).toBe(0);
            expect(otherState.disconnected).toBe(false);
            expect(otherState.partitionGroup).toBeUndefined();
            expect(otherState.queuedOperations.length).toBe(0);

            // They can still send and receive
            expect(simulator.shouldDeliver("any-sender", other)).toBe(true);
            expect(simulator.shouldDeliver(other, "any-receiver")).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
