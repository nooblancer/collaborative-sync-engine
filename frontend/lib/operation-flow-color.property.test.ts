/**
 * Property Tests for Operation Flow Visualizer - Operation Type Color Mapping
 *
 * **Validates: Requirements 16.4**
 *
 * Property 41: Operation Type Color Mapping
 * - For any operation type in the flow visualizer, create operations SHALL be
 *   colored cyan, update operations white, and delete operations red.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  getOperationColor,
  type OperationType,
} from "@/components/OperationFlowVisualizer";

// ---------------------------------------------------------------------------
// Constants (matching component color definitions)
// ---------------------------------------------------------------------------

const EXPECTED_COLORS: Record<OperationType, string> = {
  create: "#00d4ff", // cyan
  update: "#e2e8f0", // white/light
  delete: "#ef4444", // red
};

const ALL_OPERATION_TYPES: OperationType[] = ["create", "update", "delete"];

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary valid operation type */
const arbOperationType: fc.Arbitrary<OperationType> = fc.constantFrom(
  ...ALL_OPERATION_TYPES
);

// ---------------------------------------------------------------------------
// Property 41: Operation Type Color Mapping
// ---------------------------------------------------------------------------

describe("Property 41: Operation Type Color Mapping", () => {
  /**
   * **Validates: Requirements 16.4**
   *
   * For any operation type, getOperationColor SHALL return the correct color:
   * create → cyan (#00d4ff), update → white (#e2e8f0), delete → red (#ef4444).
   */
  it("maps every operation type to its correct color", () => {
    fc.assert(
      fc.property(arbOperationType, (type) => {
        const color = getOperationColor(type);
        expect(color).toBe(EXPECTED_COLORS[type]);
      }),
      { numRuns: 300 }
    );
  });

  /**
   * **Validates: Requirements 16.4**
   *
   * Create operations SHALL always be colored cyan (#00d4ff).
   */
  it("always returns cyan (#00d4ff) for create operations", () => {
    fc.assert(
      fc.property(fc.constant("create" as OperationType), (type) => {
        expect(getOperationColor(type)).toBe("#00d4ff");
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 16.4**
   *
   * Update operations SHALL always be colored white (#e2e8f0).
   */
  it("always returns white (#e2e8f0) for update operations", () => {
    fc.assert(
      fc.property(fc.constant("update" as OperationType), (type) => {
        expect(getOperationColor(type)).toBe("#e2e8f0");
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 16.4**
   *
   * Delete operations SHALL always be colored red (#ef4444).
   */
  it("always returns red (#ef4444) for delete operations", () => {
    fc.assert(
      fc.property(fc.constant("delete" as OperationType), (type) => {
        expect(getOperationColor(type)).toBe("#ef4444");
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 16.4**
   *
   * For any operation type, the returned color SHALL always be one of the three
   * valid colors — the function never returns an unexpected value.
   */
  it("always returns a valid color from the defined set for any operation type", () => {
    const validColors = Object.values(EXPECTED_COLORS);

    fc.assert(
      fc.property(arbOperationType, (type) => {
        const color = getOperationColor(type);
        expect(validColors).toContain(color);
      }),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 16.4**
   *
   * Each distinct operation type SHALL map to a distinct color — no two
   * operation types share the same color code.
   */
  it("assigns distinct colors to distinct operation types", () => {
    fc.assert(
      fc.property(
        arbOperationType,
        arbOperationType,
        (typeA, typeB) => {
          fc.pre(typeA !== typeB);
          expect(getOperationColor(typeA)).not.toBe(getOperationColor(typeB));
        }
      ),
      { numRuns: 300 }
    );
  });

  /**
   * **Validates: Requirements 16.4**
   *
   * The color mapping SHALL be deterministic — calling getOperationColor
   * multiple times with the same input always produces the same output.
   */
  it("is deterministic: same type always yields same color", () => {
    fc.assert(
      fc.property(arbOperationType, (type) => {
        const color1 = getOperationColor(type);
        const color2 = getOperationColor(type);
        expect(color1).toBe(color2);
      }),
      { numRuns: 300 }
    );
  });
});
