// Feature: sync-engine-frontend, Property 5: Quantity update clamping
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { renderHook, act } from "@testing-library/react";
import { useInventory } from "@/hooks/use-inventory";
import type { UseWebSocketReturn } from "@/hooks/use-websocket";
import type { ClientMessage, CRDTOperation } from "@/lib/types";

/**
 * Validates: Requirements 10.2
 *
 * Property: For any existing InventoryItem with quantity Q (0 ≤ Q ≤ 10,000)
 * and any delta of +1 or -1, calling updateQuantity SHALL set the item's
 * quantity to clamp(Q + delta, 0, 10000) and SHALL produce a CRDTOperation
 * message of type "update" with the clamped quantity in the payload.
 */

function createMockWebSocket(): UseWebSocketReturn & { sentMessages: ClientMessage[] } {
  const sentMessages: ClientMessage[] = [];
  const subscribers = new Map<string, Set<(msg: any) => void>>();

  return {
    status: "connected" as const,
    sendMessage: (msg: ClientMessage) => {
      sentMessages.push(msg);
    },
    lastMessage: null,
    subscribe: (type: string, handler: (msg: any) => void) => {
      if (!subscribers.has(type)) {
        subscribers.set(type, new Set());
      }
      subscribers.get(type)!.add(handler);
      return () => {
        subscribers.get(type)?.delete(handler);
      };
    },
    sentMessages,
  };
}

describe("useInventory - Property 5: Quantity update clamping", () => {
  it("updateQuantity clamps to [0, 10000] and sends correct operation", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),
        fc.constantFrom(1, -1),
        (initialQuantity, delta) => {
          const mockWs = createMockWebSocket();

          const { result } = renderHook(() => useInventory(mockWs, "TestUser"));

          // Add an item with the generated quantity
          act(() => {
            result.current.addItem("TestItem", initialQuantity);
          });

          // Get the added item's ID
          const addedItem = result.current.items[0];
          expect(addedItem).toBeDefined();
          expect(addedItem.quantity).toBe(initialQuantity);

          // Clear sent messages from the add operation
          mockWs.sentMessages.length = 0;

          // Update quantity with the generated delta
          act(() => {
            result.current.updateQuantity(addedItem.itemId, delta);
          });

          // Calculate expected clamped quantity
          const expectedQuantity = Math.max(0, Math.min(10000, initialQuantity + delta));

          // Assert: item's quantity is clamped correctly
          const updatedItem = result.current.items.find(
            (i) => i.itemId === addedItem.itemId
          );
          expect(updatedItem).toBeDefined();
          expect(updatedItem!.quantity).toBe(expectedQuantity);

          // Assert: sendMessage was called with an update operation containing the clamped quantity
          expect(mockWs.sentMessages.length).toBe(1);
          const sentMsg = mockWs.sentMessages[0];
          expect(sentMsg.type).toBe("operation");

          const operation = (sentMsg as { type: "operation"; payload: CRDTOperation }).payload;
          expect(operation.type).toBe("update");
          expect(operation.itemId).toBe(addedItem.itemId);
          expect(operation.payload?.quantity).toBe(expectedQuantity);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("quantity stays at 0 when delta is -1 (lower bound clamping)", () => {
    const mockWs = createMockWebSocket();

    const { result } = renderHook(() => useInventory(mockWs, "TestUser"));

    act(() => {
      result.current.addItem("BoundaryItem", 0);
    });

    const addedItem = result.current.items[0];
    mockWs.sentMessages.length = 0;

    act(() => {
      result.current.updateQuantity(addedItem.itemId, -1);
    });

    // Quantity should stay clamped at 0
    const updatedItem = result.current.items.find(
      (i) => i.itemId === addedItem.itemId
    );
    expect(updatedItem!.quantity).toBe(0);

    // Operation should still be sent with clamped value 0
    const sentMsg = mockWs.sentMessages[0];
    const operation = (sentMsg as { type: "operation"; payload: CRDTOperation }).payload;
    expect(operation.type).toBe("update");
    expect(operation.payload?.quantity).toBe(0);
  });

  it("quantity stays at 10000 when delta is +1 (upper bound clamping)", () => {
    const mockWs = createMockWebSocket();

    const { result } = renderHook(() => useInventory(mockWs, "TestUser"));

    act(() => {
      result.current.addItem("MaxItem", 10000);
    });

    const addedItem = result.current.items[0];
    mockWs.sentMessages.length = 0;

    act(() => {
      result.current.updateQuantity(addedItem.itemId, 1);
    });

    // Quantity should stay clamped at 10000
    const updatedItem = result.current.items.find(
      (i) => i.itemId === addedItem.itemId
    );
    expect(updatedItem!.quantity).toBe(10000);

    // Operation should still be sent with clamped value 10000
    const sentMsg = mockWs.sentMessages[0];
    const operation = (sentMsg as { type: "operation"; payload: CRDTOperation }).payload;
    expect(operation.type).toBe("update");
    expect(operation.payload?.quantity).toBe(10000);
  });
});
