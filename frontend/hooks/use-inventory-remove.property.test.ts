// Feature: sync-engine-frontend, Property 6: Remove marks item and sends operation
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { useInventory } from "./use-inventory";
import type { UseWebSocketReturn } from "./use-websocket";
import type { ClientMessage } from "@/lib/types";

/**
 * Validates: Requirements 10.3
 *
 * Property: For any existing active InventoryItem (where removedAt is null),
 * calling removeItem SHALL set removedAt to a non-null timestamp and SHALL
 * produce a CRDTOperation message of type "remove" with the correct itemId.
 */

function createMockWebSocket(): UseWebSocketReturn & {
  sentMessages: ClientMessage[];
} {
  const sentMessages: ClientMessage[] = [];

  return {
    status: "connected",
    sendMessage: vi.fn((msg: ClientMessage) => {
      sentMessages.push(msg);
    }),
    lastMessage: null,
    subscribe: vi.fn(() => () => {}),
    sentMessages,
  };
}

// Generators
const arbValidName = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0 && s.trim().length <= 100);

const arbValidQuantity = fc.integer({ min: 0, max: 10000 });

describe("useInventory - Property 6: Remove marks item and sends operation", () => {
  it("removeItem sets removedAt to a non-null timestamp and sends a remove operation", () => {
    fc.assert(
      fc.property(arbValidName, arbValidQuantity, (name, quantity) => {
        const mockWs = createMockWebSocket();

        const { result } = renderHook(() =>
          useInventory(mockWs, "TestUser")
        );

        // Add an item first
        act(() => {
          result.current.addItem(name, quantity);
        });

        // Get the itemId of the added item
        expect(result.current.items.length).toBe(1);
        const itemId = result.current.items[0].itemId;
        expect(result.current.items[0].removedAt).toBeNull();

        // Clear sent messages to isolate remove operation
        mockWs.sentMessages.length = 0;
        (mockWs.sendMessage as ReturnType<typeof vi.fn>).mockClear();

        // Remove the item
        act(() => {
          result.current.removeItem(itemId);
        });

        // Assert: removedAt is set to a non-null number
        const removedItem = result.current.items.find(
          (i) => i.itemId === itemId
        );
        expect(removedItem).toBeDefined();
        expect(removedItem!.removedAt).not.toBeNull();
        expect(typeof removedItem!.removedAt).toBe("number");

        // Assert: sendMessage was called with a remove operation
        expect(mockWs.sendMessage).toHaveBeenCalledTimes(1);
        const sentMsg = mockWs.sentMessages[0];
        expect(sentMsg.type).toBe("operation");
        if (sentMsg.type === "operation") {
          expect(sentMsg.payload.type).toBe("remove");
          expect(sentMsg.payload.itemId).toBe(itemId);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("removeItem on an already-removed item does not send another operation", () => {
    fc.assert(
      fc.property(arbValidName, arbValidQuantity, (name, quantity) => {
        const mockWs = createMockWebSocket();

        const { result } = renderHook(() =>
          useInventory(mockWs, "TestUser")
        );

        // Add and remove an item
        act(() => {
          result.current.addItem(name, quantity);
        });

        const itemId = result.current.items[0].itemId;

        act(() => {
          result.current.removeItem(itemId);
        });

        // Clear messages after first remove
        mockWs.sentMessages.length = 0;
        (mockWs.sendMessage as ReturnType<typeof vi.fn>).mockClear();

        // Try to remove again
        act(() => {
          result.current.removeItem(itemId);
        });

        // Should not send another operation
        expect(mockWs.sendMessage).not.toHaveBeenCalled();
        expect(mockWs.sentMessages.length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });
});
