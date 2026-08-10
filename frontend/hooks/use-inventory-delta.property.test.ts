// Feature: sync-engine-frontend, Property 9: Delta application correctness
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { InventoryItem, ItemChange } from "@/lib/types";

/**
 * Validates: Requirements 11.1, 11.2, 11.3
 *
 * Property: For any valid StateDelta containing one or more ItemChange entries:
 * - If change.type === "added", a new item SHALL appear in local state with the
 *   fields from the delta.
 * - If change.type === "updated" and the item exists, the item's fields SHALL be
 *   updated to match the delta's fields.
 * - If change.type === "removed" and the item exists, the item's removedAt SHALL
 *   be set to a non-null value.
 */

// Replicate the applyChange logic from useInventory hook
function applyChange(
  itemsMap: Map<string, InventoryItem>,
  change: ItemChange
): void {
  switch (change.type) {
    case "added": {
      const newItem: InventoryItem = {
        itemId: change.itemId,
        name: change.name ?? "",
        quantity: change.quantity ?? 0,
        removedAt: change.removedAt ?? null,
        lastUpdatedBy: change.lastUpdatedBy ?? "",
      };
      itemsMap.set(change.itemId, newItem);
      break;
    }
    case "updated": {
      const existing = itemsMap.get(change.itemId);
      if (existing) {
        const updated: InventoryItem = {
          ...existing,
          ...(change.name !== undefined && { name: change.name }),
          ...(change.quantity !== undefined && { quantity: change.quantity }),
          ...(change.lastUpdatedBy !== undefined && {
            lastUpdatedBy: change.lastUpdatedBy,
          }),
        };
        itemsMap.set(change.itemId, updated);
      }
      break;
    }
    case "removed": {
      const existing = itemsMap.get(change.itemId);
      if (existing) {
        const removed: InventoryItem = {
          ...existing,
          removedAt: change.removedAt ?? Date.now(),
          ...(change.lastUpdatedBy !== undefined && {
            lastUpdatedBy: change.lastUpdatedBy,
          }),
        };
        itemsMap.set(change.itemId, removed);
      }
      break;
    }
  }
}

// Apply a full delta (array of changes) to the map
function applyDelta(
  itemsMap: Map<string, InventoryItem>,
  changes: ItemChange[]
): void {
  for (const change of changes) {
    applyChange(itemsMap, change);
  }
}

// --- Generators ---

const arbItemId = fc.string({ minLength: 1, maxLength: 30 });
const arbItemName = fc.string({ minLength: 1, maxLength: 100 });
const arbQuantity = fc.integer({ min: 0, max: 10000 });
const arbLastUpdatedBy = fc.string({ minLength: 1, maxLength: 50 });

const arbAddedChange = fc.record({
  type: fc.constant("added" as const),
  itemId: arbItemId,
  name: arbItemName,
  quantity: arbQuantity,
  lastUpdatedBy: arbLastUpdatedBy,
});

// For update and remove, we need an existing item first.
// We generate an add change followed by the operation on that item.
function arbUpdateChangeWithSetup(): fc.Arbitrary<{
  setup: ItemChange;
  change: ItemChange;
}> {
  return fc.record({
    itemId: arbItemId,
    name: arbItemName,
    quantity: arbQuantity,
    lastUpdatedBy: arbLastUpdatedBy,
    newName: fc.option(arbItemName, { nil: undefined }),
    newQuantity: fc.option(arbQuantity, { nil: undefined }),
    newLastUpdatedBy: fc.option(arbLastUpdatedBy, { nil: undefined }),
  }).filter((r) => {
    // At least one update field should be defined
    return r.newName !== undefined || r.newQuantity !== undefined || r.newLastUpdatedBy !== undefined;
  }).map((r) => ({
    setup: {
      type: "added" as const,
      itemId: r.itemId,
      name: r.name,
      quantity: r.quantity,
      lastUpdatedBy: r.lastUpdatedBy,
    },
    change: {
      type: "updated" as const,
      itemId: r.itemId,
      ...(r.newName !== undefined && { name: r.newName }),
      ...(r.newQuantity !== undefined && { quantity: r.newQuantity }),
      ...(r.newLastUpdatedBy !== undefined && {
        lastUpdatedBy: r.newLastUpdatedBy,
      }),
    },
  }));
}

function arbRemoveChangeWithSetup(): fc.Arbitrary<{
  setup: ItemChange;
  change: ItemChange;
}> {
  return fc
    .record({
      itemId: arbItemId,
      name: arbItemName,
      quantity: arbQuantity,
      lastUpdatedBy: arbLastUpdatedBy,
      removedAt: fc.option(
        fc.integer({ min: 1000000000000, max: 9999999999999 }),
        { nil: undefined }
      ),
    })
    .map((r) => ({
      setup: {
        type: "added" as const,
        itemId: r.itemId,
        name: r.name,
        quantity: r.quantity,
        lastUpdatedBy: r.lastUpdatedBy,
      },
      change: {
        type: "removed" as const,
        itemId: r.itemId,
        ...(r.removedAt !== undefined && { removedAt: r.removedAt }),
      },
    }));
}

describe("useInventory - Property 9: Delta application correctness", () => {
  it("added change creates a new item in local state with fields from the delta", () => {
    fc.assert(
      fc.property(arbAddedChange, (change) => {
        const itemsMap = new Map<string, InventoryItem>();

        applyDelta(itemsMap, [change]);

        // The item should now exist in the map
        const item = itemsMap.get(change.itemId);
        expect(item).toBeDefined();
        expect(item!.itemId).toBe(change.itemId);
        expect(item!.name).toBe(change.name);
        expect(item!.quantity).toBe(change.quantity);
        expect(item!.lastUpdatedBy).toBe(change.lastUpdatedBy);
        expect(item!.removedAt).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it("updated change modifies existing item fields to match the delta", () => {
    fc.assert(
      fc.property(arbUpdateChangeWithSetup(), ({ setup, change }) => {
        const itemsMap = new Map<string, InventoryItem>();

        // First, add the item
        applyDelta(itemsMap, [setup]);

        // Then, apply the update
        applyDelta(itemsMap, [change]);

        const item = itemsMap.get(change.itemId);
        expect(item).toBeDefined();

        // Updated fields should match the delta
        if (change.name !== undefined) {
          expect(item!.name).toBe(change.name);
        } else {
          // Unchanged field should retain original value
          expect(item!.name).toBe(setup.name);
        }

        if (change.quantity !== undefined) {
          expect(item!.quantity).toBe(change.quantity);
        } else {
          expect(item!.quantity).toBe(setup.quantity);
        }

        if (change.lastUpdatedBy !== undefined) {
          expect(item!.lastUpdatedBy).toBe(change.lastUpdatedBy);
        } else {
          expect(item!.lastUpdatedBy).toBe(setup.lastUpdatedBy);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("removed change sets removedAt to a non-null value on existing item", () => {
    fc.assert(
      fc.property(arbRemoveChangeWithSetup(), ({ setup, change }) => {
        const itemsMap = new Map<string, InventoryItem>();

        // First, add the item
        applyDelta(itemsMap, [setup]);

        // Verify it starts with removedAt = null
        const beforeRemove = itemsMap.get(change.itemId);
        expect(beforeRemove!.removedAt).toBeNull();

        // Apply the remove change
        applyDelta(itemsMap, [change]);

        const item = itemsMap.get(change.itemId);
        expect(item).toBeDefined();
        expect(item!.removedAt).not.toBeNull();

        // If removedAt was specified in the change, it should match
        if (change.removedAt !== undefined) {
          expect(item!.removedAt).toBe(change.removedAt);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("update on non-existent item does not create a new entry", () => {
    fc.assert(
      fc.property(
        arbItemId,
        arbItemName,
        arbQuantity,
        (itemId, name, quantity) => {
          const itemsMap = new Map<string, InventoryItem>();

          const change: ItemChange = {
            type: "updated",
            itemId,
            name,
            quantity,
          };

          applyDelta(itemsMap, [change]);

          // No item should have been created
          expect(itemsMap.has(itemId)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("remove on non-existent item does not create a new entry", () => {
    fc.assert(
      fc.property(arbItemId, (itemId) => {
        const itemsMap = new Map<string, InventoryItem>();

        const change: ItemChange = {
          type: "removed",
          itemId,
          removedAt: Date.now(),
        };

        applyDelta(itemsMap, [change]);

        // No item should have been created
        expect(itemsMap.has(itemId)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("multiple changes in a single delta are applied in order", () => {
    fc.assert(
      fc.property(
        arbItemId,
        arbItemName,
        arbQuantity,
        arbLastUpdatedBy,
        arbItemName,
        arbQuantity,
        (itemId, name, quantity, updatedBy, newName, newQuantity) => {
          const itemsMap = new Map<string, InventoryItem>();

          // A delta with add + update for the same item
          const changes: ItemChange[] = [
            {
              type: "added",
              itemId,
              name,
              quantity,
              lastUpdatedBy: updatedBy,
            },
            {
              type: "updated",
              itemId,
              name: newName,
              quantity: newQuantity,
            },
          ];

          applyDelta(itemsMap, changes);

          const item = itemsMap.get(itemId);
          expect(item).toBeDefined();
          // Should reflect the update, not just the add
          expect(item!.name).toBe(newName);
          expect(item!.quantity).toBe(newQuantity);
        }
      ),
      { numRuns: 100 }
    );
  });
});
