// Feature: v2.5-whiteboard-page, Property 1: Element diff detects all changes with no false positives
import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

// Mock @excalidraw/excalidraw to avoid JSON import issues in test environment
vi.mock("@excalidraw/excalidraw", () => ({
  exportToBlob: vi.fn(),
}));

import { diffElements } from "@/lib/excalidraw-sync-utils";

// Minimal ExcalidrawElement-like type with just the fields diffElements uses
interface MinimalElement {
  id: string;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
}

// Minimal element generator with the fields diffElements actually uses
const elementArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 10 }),
  version: fc.nat({ max: 100 }),
  versionNonce: fc.nat({ max: 1000000 }),
  isDeleted: fc.boolean(),
});

function toExcalidrawElement(el: MinimalElement): ExcalidrawElement {
  return el as unknown as ExcalidrawElement;
}

/**
 * Validates: Requirements 5.1
 *
 * Property 1: Element diff detects all changes with no false positives
 *
 * For any two arrays of Excalidraw elements (previous snapshot and current state),
 * the diffElements function SHALL produce an operation for every element that was
 * added (new id), updated (higher version or different versionNonce), or removed
 * (isDeleted changed to true), and SHALL NOT produce operations for elements that
 * are unchanged (same version and versionNonce).
 */
describe("diffElements - Property 1: Element diff detects all changes with no false positives", () => {
  it("new ids produce 'add' ops", () => {
    fc.assert(
      fc.property(
        fc.array(elementArb, { minLength: 0, maxLength: 10 }),
        fc.array(elementArb, { minLength: 1, maxLength: 10 }),
        (prevElements, newElements) => {
          const prev = prevElements.map(toExcalidrawElement);
          const prevIds = new Set(prev.map((el) => el.id));

          // Ensure new elements have IDs not in prev
          const uniqueNew = newElements
            .filter((el) => !prevIds.has(el.id))
            .map(toExcalidrawElement);

          if (uniqueNew.length === 0) return; // skip trivial case

          const current = [...prev, ...uniqueNew];
          const ops = diffElements(prev, current);

          // Every truly new element should have an "add" op
          for (const el of uniqueNew) {
            const op = ops.find((o) => o.itemId === el.id);
            expect(op).toBeDefined();
            expect(op!.type).toBe("add");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("higher version or different nonce produces 'update' ops (when not deleted)", () => {
    fc.assert(
      fc.property(
        fc.array(elementArb, { minLength: 1, maxLength: 10 }),
        (elements) => {
          const prev = elements.map(toExcalidrawElement);

          // Create current with bumped version or different nonce, not deleted
          const current = prev.map((el) => ({
            ...el,
            version: (el as unknown as MinimalElement).version + 1,
            isDeleted: false,
          })) as unknown as ExcalidrawElement[];

          const ops = diffElements(prev, current);

          for (const el of current) {
            const prevEl = prev.find((p) => p.id === el.id);
            if (!prevEl) continue;
            const op = ops.find((o) => o.itemId === el.id);
            expect(op).toBeDefined();
            expect(op!.type).toBe("update");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("isDeleted transition produces 'remove' ops", () => {
    fc.assert(
      fc.property(
        fc.array(elementArb, { minLength: 1, maxLength: 10 }),
        (elements) => {
          // Prev elements are NOT deleted
          const prev = elements.map((el) =>
            toExcalidrawElement({ ...el, isDeleted: false })
          );

          // Current elements ARE deleted with bumped version
          const current = prev.map((el) => ({
            ...el,
            version: (el as unknown as MinimalElement).version + 1,
            isDeleted: true,
          })) as unknown as ExcalidrawElement[];

          const ops = diffElements(prev, current);

          for (const el of current) {
            const op = ops.find((o) => o.itemId === el.id);
            expect(op).toBeDefined();
            expect(op!.type).toBe("remove");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("unchanged elements produce no ops (no false positives)", () => {
    fc.assert(
      fc.property(
        fc.array(elementArb, { minLength: 1, maxLength: 10 }),
        (elements) => {
          // Use unique ids to avoid collisions
          const uniqueElements = elements.map((el, i) => ({
            ...el,
            id: `el-${i}`,
          }));
          const prev = uniqueElements.map(toExcalidrawElement);
          // Current is identical to prev
          const current = [...prev];

          const ops = diffElements(prev, current);

          // No operations should be produced for unchanged elements
          expect(ops.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
