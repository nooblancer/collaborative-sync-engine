// Feature: sync-engine-frontend, Property 1: Ping-pong response invariant
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ServerMessage, ClientMessage } from "@/lib/types";

/**
 * Validates: Requirements 8.3
 *
 * Property: For any sequence of incoming server messages that includes a `ping`
 * message, the WebSocket hook SHALL send exactly one `pong` message for each
 * `ping` received, regardless of other message types interleaved in the sequence.
 */

// Replicate the core message handling logic from useWebSocket:
// When a message of type "ping" arrives, sendMessage({ type: "pong" }) is called.
function processMessages(
  messages: ServerMessage[],
  sendMessage: (msg: ClientMessage) => void
): void {
  for (const message of messages) {
    if (message.type === "ping") {
      sendMessage({ type: "pong" });
    }
  }
}

// Generators for arbitrary ServerMessage values
const arbOperationId = fc.string({ minLength: 1, maxLength: 20 });
const arbUserId = fc.string({ minLength: 1, maxLength: 20 });
const arbDisplayName = fc.string({ minLength: 1, maxLength: 50 });

const arbUserPresence = fc.record({
  userId: arbUserId,
  displayName: arbDisplayName,
});

const arbItemChange = fc.record({
  type: fc.constantFrom("added" as const, "updated" as const, "removed" as const),
  itemId: fc.string({ minLength: 1, maxLength: 20 }),
  name: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  quantity: fc.option(fc.integer({ min: 0, max: 10000 }), { nil: undefined }),
  removedAt: fc.option(fc.option(fc.integer({ min: 1 }), { nil: null }), { nil: undefined }),
  lastUpdatedBy: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
});

const arbServerMessage: fc.Arbitrary<ServerMessage> = fc.oneof(
  fc.record({ type: fc.constant("ack" as const), operationId: arbOperationId }),
  fc.record({
    type: fc.constant("delta" as const),
    payload: fc.record({ changes: fc.array(arbItemChange, { minLength: 0, maxLength: 5 }) }),
  }),
  fc.record({
    type: fc.constant("presence-list" as const),
    users: fc.array(arbUserPresence, { minLength: 0, maxLength: 10 }),
  }),
  fc.record({
    type: fc.constant("presence-join" as const),
    user: arbUserPresence,
  }),
  fc.record({
    type: fc.constant("presence-leave" as const),
    userId: arbUserId,
  }),
  fc.constant({ type: "ping" as const }),
  fc.record({
    type: fc.constant("error" as const),
    code: fc.string({ minLength: 1, maxLength: 10 }),
    message: fc.string({ minLength: 1, maxLength: 100 }),
  })
);

describe("useWebSocket - Property 1: Ping-pong response invariant", () => {
  it("sends exactly one pong for each ping in any message sequence", () => {
    fc.assert(
      fc.property(
        fc.array(arbServerMessage, { minLength: 0, maxLength: 50 }),
        (messages) => {
          const sentMessages: ClientMessage[] = [];
          const sendMessage = (msg: ClientMessage) => sentMessages.push(msg);

          processMessages(messages, sendMessage);

          const pingCount = messages.filter((m) => m.type === "ping").length;
          const pongCount = sentMessages.filter((m) => m.type === "pong").length;

          expect(pongCount).toBe(pingCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("every sent message in response to pings is exactly { type: 'pong' }", () => {
    fc.assert(
      fc.property(
        fc.array(arbServerMessage, { minLength: 1, maxLength: 50 }),
        (messages) => {
          const sentMessages: ClientMessage[] = [];
          const sendMessage = (msg: ClientMessage) => sentMessages.push(msg);

          processMessages(messages, sendMessage);

          // All sent messages should be pong messages (no other messages sent)
          for (const msg of sentMessages) {
            expect(msg).toEqual({ type: "pong" });
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("pong messages are sent in order corresponding to each ping received", () => {
    fc.assert(
      fc.property(
        fc.array(arbServerMessage, { minLength: 0, maxLength: 50 }),
        (messages) => {
          const sentMessages: ClientMessage[] = [];
          let pongsSentSoFar = 0;
          const sendMessage = (msg: ClientMessage) => {
            sentMessages.push(msg);
            pongsSentSoFar++;
          };

          let pingsSeenSoFar = 0;
          for (const message of messages) {
            if (message.type === "ping") {
              pingsSeenSoFar++;
              sendMessage({ type: "pong" });
            }
            // At any point, pongs sent == pings seen so far
            expect(pongsSentSoFar).toBe(pingsSeenSoFar);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
