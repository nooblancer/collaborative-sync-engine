// Feature: sync-engine-frontend, Property 4: Valid add produces local item and operation
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { renderHook, act } from "@testing-library/react";
import { useInventory } from "./use-inventory";
import type { UseWebSocketReturn } from "./use-websocket";
import type { ClientMessage } from "@/lib/types";

/**
 * Validates: Requirements 10.1
 *
 * Property: For any valid item name (1-100 non-empty characters) and valid
 * quantity (integer 0-10,000), calling `addItem` SHALL insert a new
 * `InventoryItem` into local state with the given name and quantity, and SHALL
 * produce a `CRDTOperation` message of type "add" with matching `name` and
 * `quantity` in the payload.
 */

function createMockWebSocket(): UseWebSocketReturn & { sentMessages: ClientMessage[] } {
  const sentMessages: ClientMessage[] = [];

  return {
    status: "connected",
    sendMessage: (msg: ClientMessage) => {
      sentMessages.push(msg);
    },
    lastMessage: null,
    subscribe: () => () => {},
    sentMessages,
  };
}

// Generator for valid item names: 1-100 non-whitespace-only characters
const arbValidName = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0 && s.trim().length <= 100);

// Generator for valid quantities: integer in [0, 10000]
const arbValidQuantity = fc.integer({ min: 0, max: 10000 });

describe("useInventory - Property 4: Valid add produces local item and operation", () => {
  it("addItem with valid name and quantity inserts item into local state and sends operation", () => {
    fc.assert(
      fc.property(arbValidName, arbValidQuantity, (name, quantity) => {
        const mockWs = createMockWebSocket();

        const { result } = renderHook(() => useInventory(mockWs, "TestUser"));

        act(() => {
          result.current.addItem(name, quantity);
        });

        const trimmedName = name.trim();

        // Assert: local state contains the new item with trimmed name and exact quantity
        const items = result.current.items;
        const addedItem = items.find(
          (item) => item.name === trimmedName && item.quantity === quantity
        );
        expect(addedItem).toBeDefined();
        expect(addedItem!.name).toBe(trimmedName);
        expect(addedItem!.quantity).toBe(quantity);
        expect(addedItem!.removedAt).toBeNull();
        expect(addedItem!.lastUpdatedBy).toBe("TestUser");

        // Assert: sendMessage was called with a message containing type "operation"
        // and payload with type "add", matching name and quantity
        expect(mockWs.sentMessages.length).toBe(1);
        const sentMsg = mockWs.sentMessages[0];
        expect(sentMsg.type).toBe("operation");

        if (sentMsg.type === "operation") {
          const operation = sentMsg.payload;
          expect(operation.type).toBe("add");
          expect(operation.payload).toBeDefined();
          expect(operation.payload!.name).toBe(trimmedName);
          expect(operation.payload!.quantity).toBe(quantity);
          expect(operation.itemId).toBeDefined();
          expect(operation.itemId.length).toBeGreaterThan(0);
          expect(operation.operationId).toBeDefined();
          expect(operation.operationId.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("addItem generates a unique itemId for each added item", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(arbValidName, arbValidQuantity),
          { minLength: 2, maxLength: 5 }
        ),
        (inputs) => {
          const mockWs = createMockWebSocket();
          const { result } = renderHook(() => useInventory(mockWs, "TestUser"));

          act(() => {
            for (const [name, quantity] of inputs) {
              result.current.addItem(name, quantity);
            }
          });

          // All items should have unique itemIds
          const itemIds = result.current.items.map((item) => item.itemId);
          const uniqueIds = new Set(itemIds);
          expect(itemIds.length).toBe(uniqueIds.size);
        }
      ),
      { numRuns: 100 }
    );
  });
});
