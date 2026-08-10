// Feature: sync-engine-frontend, Property 8: Inventory table row completeness
import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { render } from "@testing-library/react";
import { InventoryRow } from "./inventory-row";
import type { InventoryItem } from "@/lib/types";

/**
 * Validates: Requirements 10.6
 *
 * Property: For any InventoryItem in the inventory state, the rendered table row
 * SHALL contain the item's name, quantity (as text), and lastUpdatedBy value,
 * plus action buttons for increment, decrement, and remove.
 */

// Generator for printable characters that won't break text queries
const arbNonSpaceChar = fc.char().filter(
  (c) => c.charCodeAt(0) >= 33 && c.charCodeAt(0) <= 126
);

const arbPrintableChar = fc.char().filter(
  (c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126
);

// Names: 1-100 characters with at least one non-whitespace character
const arbName = fc
  .tuple(
    fc.stringOf(arbPrintableChar, { minLength: 0, maxLength: 49 }),
    arbNonSpaceChar,
    fc.stringOf(arbPrintableChar, { minLength: 0, maxLength: 49 })
  )
  .map(([prefix, core, suffix]) => `${prefix}${core}${suffix}`.slice(0, 100))
  .filter((s) => s.length >= 1 && s.length <= 100);

// Quantities: integer 0-10000
const arbQuantity = fc.integer({ min: 0, max: 10000 });

// lastUpdatedBy: 1-50 characters with at least one non-whitespace
const arbLastUpdatedBy = fc
  .tuple(
    fc.stringOf(arbPrintableChar, { minLength: 0, maxLength: 24 }),
    arbNonSpaceChar,
    fc.stringOf(arbPrintableChar, { minLength: 0, maxLength: 24 })
  )
  .map(([prefix, core, suffix]) => `${prefix}${core}${suffix}`.slice(0, 50))
  .filter((s) => s.length >= 1 && s.length <= 50);

// itemId: 1-30 characters
const arbItemId = fc.string({ minLength: 1, maxLength: 30 });

// Generator for active InventoryItems (removedAt is null)
const arbInventoryItem: fc.Arbitrary<InventoryItem> = fc.record({
  itemId: arbItemId,
  name: arbName,
  quantity: arbQuantity,
  removedAt: fc.constant(null),
  lastUpdatedBy: arbLastUpdatedBy,
});

describe("InventoryRow - Property 8: Inventory table row completeness", () => {
  it("renders name, quantity, lastUpdatedBy, and action buttons for any valid InventoryItem", () => {
    fc.assert(
      fc.property(arbInventoryItem, (item) => {
        const { unmount, container } = render(
          <table>
            <tbody>
              <InventoryRow
                item={item}
                isFlashing={false}
                onIncrement={vi.fn()}
                onDecrement={vi.fn()}
                onRemove={vi.fn()}
              />
            </tbody>
          </table>
        );

        // Assert: rendered output contains the item's name
        const cells = container.querySelectorAll("td");
        const cellTexts = Array.from(cells).map((c) => c.textContent);
        expect(cellTexts.some((t) => t?.includes(item.name))).toBe(true);

        // Assert: rendered output contains the quantity as text
        expect(
          cellTexts.some((t) => t?.includes(String(item.quantity)))
        ).toBe(true);

        // Assert: rendered output contains lastUpdatedBy
        expect(
          cellTexts.some((t) => t?.includes(item.lastUpdatedBy))
        ).toBe(true);

        // Assert: action buttons for increment, decrement, and remove exist
        const incrementBtn = container.querySelector(
          '[aria-label="Increment quantity"]'
        );
        const decrementBtn = container.querySelector(
          '[aria-label="Decrement quantity"]'
        );
        const removeBtn = container.querySelector(
          '[aria-label="Remove item"]'
        );

        expect(incrementBtn).not.toBeNull();
        expect(decrementBtn).not.toBeNull();
        expect(removeBtn).not.toBeNull();

        unmount();
      }),
      { numRuns: 100 }
    );
  });
});
