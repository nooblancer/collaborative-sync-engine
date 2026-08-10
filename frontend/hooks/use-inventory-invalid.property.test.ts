// Feature: sync-engine-frontend, Property 7: Invalid input rejection
import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { renderHook, act } from "@testing-library/react";
import { useInventory } from "@/hooks/use-inventory";
import type { UseWebSocketReturn } from "@/hooks/use-websocket";

/**
 * Validates: Requirements 10.4, 10.5
 *
 * Property: For any item name that is empty or consists only of whitespace,
 * OR for any quantity value outside the range [0, 10000], the add-item operation
 * SHALL be rejected without modifying the inventory state and without sending
 * any WebSocket message.
 */

function createMockWebSocket(): UseWebSocketReturn {
  return {
    status: "connected",
    sendMessage: vi.fn(),
    lastMessage: null,
    subscribe: vi.fn(() => () => {}),
  };
}

describe("useInventory - Property 7: Invalid input rejection", () => {
  it("rejects empty names — empty string, spaces, tabs", () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r"), {
          minLength: 0,
          maxLength: 20,
        }),
        fc.integer({ min: 0, max: 10000 }),
        (whitespaceOnlyName, validQuantity) => {
          const mockWs = createMockWebSocket();
          const { result } = renderHook(() =>
            useInventory(mockWs, "TestUser")
          );

          act(() => {
            result.current.addItem(whitespaceOnlyName, validQuantity);
          });

          // State should remain empty
          expect(result.current.items).toHaveLength(0);
          // No WebSocket message should be sent
          expect(mockWs.sendMessage).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects names that are too long (> 100 chars when trimmed)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 101, maxLength: 200 }).filter(
          (s) => s.trim().length > 100
        ),
        fc.integer({ min: 0, max: 10000 }),
        (longName, validQuantity) => {
          const mockWs = createMockWebSocket();
          const { result } = renderHook(() =>
            useInventory(mockWs, "TestUser")
          );

          act(() => {
            result.current.addItem(longName, validQuantity);
          });

          expect(result.current.items).toHaveLength(0);
          expect(mockWs.sendMessage).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects quantities below 0", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter(
          (s) => s.trim().length > 0 && s.trim().length <= 100
        ),
        fc.integer({ max: -1 }),
        (validName, negativeQuantity) => {
          const mockWs = createMockWebSocket();
          const { result } = renderHook(() =>
            useInventory(mockWs, "TestUser")
          );

          act(() => {
            result.current.addItem(validName, negativeQuantity);
          });

          expect(result.current.items).toHaveLength(0);
          expect(mockWs.sendMessage).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects quantities above 10000", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter(
          (s) => s.trim().length > 0 && s.trim().length <= 100
        ),
        fc.integer({ min: 10001 }),
        (validName, overMaxQuantity) => {
          const mockWs = createMockWebSocket();
          const { result } = renderHook(() =>
            useInventory(mockWs, "TestUser")
          );

          act(() => {
            result.current.addItem(validName, overMaxQuantity);
          });

          expect(result.current.items).toHaveLength(0);
          expect(mockWs.sendMessage).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects non-integer quantities", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter(
          (s) => s.trim().length > 0 && s.trim().length <= 100
        ),
        fc.double({ min: -1000, max: 11000, noNaN: true }).filter(
          (n) => !Number.isInteger(n)
        ),
        (validName, nonIntegerQuantity) => {
          const mockWs = createMockWebSocket();
          const { result } = renderHook(() =>
            useInventory(mockWs, "TestUser")
          );

          act(() => {
            result.current.addItem(validName, nonIntegerQuantity);
          });

          expect(result.current.items).toHaveLength(0);
          expect(mockWs.sendMessage).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});
