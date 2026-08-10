// Feature: sync-engine-frontend, Property 10: Remote change flash tracking
import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { renderHook, act } from "@testing-library/react";
import { useInventory } from "./use-inventory";
import type { UseWebSocketReturn } from "./use-websocket";
import type { ClientMessage, ServerMessage, ItemChange } from "@/lib/types";

/**
 * Validates: Requirements 11.4
 *
 * Property: For any incoming delta message applied to the inventory state,
 * the `flashingItemId` SHALL be set to the `itemId` of the most recently
 * changed item in that delta.
 */

function createMockWebSocket(): UseWebSocketReturn & {
  sentMessages: ClientMessage[];
  subscribers: Map<string, (msg: ServerMessage) => void>;
} {
  const sentMessages: ClientMessage[] = [];
  const subscribers = new Map<string, (msg: ServerMessage) => void>();

  return {
    status: "connected",
    sendMessage: vi.fn((msg: ClientMessage) => {
      sentMessages.push(msg);
    }),
    lastMessage: null,
    subscribe: vi.fn(
      (type: string, handler: (msg: ServerMessage) => void) => {
        subscribers.set(type, handler);
        return () => {
          subscribers.delete(type);
        };
      }
    ),
    sentMessages,
    subscribers,
  };
}

// Generator for item IDs
const arbItemId = fc.string({ minLength: 1, maxLength: 30 });

// Generator for a single "added" change (simplest — always creates items)
const arbAddedChange = fc.record({
  type: fc.constant("added" as const),
  itemId: arbItemId,
  name: fc.string({ minLength: 1, maxLength: 50 }),
  quantity: fc.integer({ min: 0, max: 10000 }),
  lastUpdatedBy: fc.string({ minLength: 1, maxLength: 30 }),
});

// Generator for a delta with 1-5 "added" changes, each with a unique itemId
const arbDeltaChanges = fc
  .array(arbAddedChange, { minLength: 1, maxLength: 5 })
  .map((changes) => {
    // Ensure unique itemIds by appending index
    return changes.map((c, i) => ({
      ...c,
      itemId: `${c.itemId}-${i}`,
    }));
  });

describe("useInventory - Property 10: Remote change flash tracking", () => {
  it("flashingItemId is set to the last itemId in the delta changes array", () => {
    fc.assert(
      fc.property(arbDeltaChanges, (changes) => {
        const mockWs = createMockWebSocket();

        const { result } = renderHook(() =>
          useInventory(mockWs, "TestUser")
        );

        // Build the delta message
        const deltaMsg: ServerMessage = {
          type: "delta",
          payload: { changes },
        };

        // Invoke the delta subscriber
        act(() => {
          const deltaHandler = mockWs.subscribers.get("delta");
          expect(deltaHandler).toBeDefined();
          deltaHandler!(deltaMsg);
        });

        // The flashingItemId should be the last change's itemId
        const expectedFlashId = changes[changes.length - 1].itemId;
        expect(result.current.flashingItemId).toBe(expectedFlashId);
      }),
      { numRuns: 100 }
    );
  });
});
