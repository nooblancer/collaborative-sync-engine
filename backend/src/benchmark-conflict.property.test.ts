/**
 * Property-based tests for conflict resolution benchmark - CRDT convergence.
 *
 * Feature: v2.4.2, Property 2: CRDT Convergence Under Contention
 */

import path from "path";
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { generateContentionWorkload } from "./benchmark-workloads.js";

// Load the native merge addon (same pattern as benchmark-conflict.ts)
const nativeMergePath = path.join(
  __dirname,
  "..",
  "native-merge",
  "native-merge.node"
);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeMerge = require(nativeMergePath) as {
  mergeBatch: (state: Buffer, operations: Buffer[]) => Buffer;
};

/**
 * Process a fixed workload through the merge engine and return the final state item count.
 * Mirrors the logic in `runConflictBenchmark` without timing/memory concerns.
 */
function processWorkload(workload: Buffer[], batchSize: number): number {
  const ops = workload.length;
  const totalBatches = Math.ceil(ops / batchSize);

  const initialState = JSON.stringify({
    sessionId: "benchmark-contention",
    items: {},
    version: 0,
    lastUpdated: { wallTime: 0, logical: 0, nodeId: "benchmark-contention" },
  });

  let currentState: Buffer = Buffer.from(initialState);

  for (let batch = 0; batch < totalBatches; batch++) {
    const start = batch * batchSize;
    const end = Math.min(start + batchSize, ops);
    const batchOps = workload.slice(start, end);

    const resultBuffer = nativeMerge.mergeBatch(currentState, batchOps);
    const result = JSON.parse(resultBuffer.toString()) as {
      state: {
        sessionId: string;
        items: Record<string, unknown>;
        version: number;
        lastUpdated: { wallTime: number; logical: number; nodeId: string };
      };
    };

    currentState = Buffer.from(JSON.stringify(result.state));
  }

  const finalState = JSON.parse(currentState.toString()) as {
    items: Record<string, unknown>;
  };
  return Object.keys(finalState.items).length;
}

// Feature: v2.4.2, Property 2: CRDT Convergence Under Contention
describe("Property 2: CRDT Convergence Under Contention", () => {
  /**
   * **Validates: Requirements 1.3**
   *
   * For any fixed contention workload (same operations, same order), running
   * the conflict benchmark twice with identical parameters SHALL produce the
   * same `finalStateItemCount` value, confirming deterministic CRDT convergence.
   *
   * Strategy: Generate a contention workload once for each test case, then
   * process it through the merge engine twice with the same batch size.
   * Both runs must produce identical finalStateItemCount.
   */
  it("produces the same finalStateItemCount when run twice with the same workload", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 500 }).chain((ops) =>
          fc.tuple(
            fc.constant(ops),
            fc.integer({ min: 10, max: Math.max(10, Math.floor(ops / 2)) })
          )
        ),
        ([ops, batchSize]) => {
          // Generate a fixed contention workload for this test case
          const fixedWorkload = generateContentionWorkload(ops);

          // Run the same workload through the merge engine twice
          const result1 = processWorkload(fixedWorkload, batchSize);
          const result2 = processWorkload(fixedWorkload, batchSize);

          // Both runs MUST produce the same finalStateItemCount (convergence)
          expect(result1).toBe(result2);

          // The final state should have at least 1 item (sanity check)
          expect(result1).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
