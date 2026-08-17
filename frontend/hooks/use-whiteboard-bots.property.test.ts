// Feature: v2.5-whiteboard-page, Property 6: Bot activation invariant
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { shouldBotsBeActive } from "@/components/demo/WhiteboardCanvas";

/**
 * Validates: Requirements 7.1, 7.2, 7.3
 *
 * Property 6: Bot activation invariant
 *
 * For any list of participant clientIds, shouldBotsBeActive(participants, "bot-")
 * SHALL return true if and only if the count of participants whose clientId does
 * NOT start with "bot-" is less than 2. This holds regardless of the total number
 * of bots or the order of participants.
 */
describe("shouldBotsBeActive - Property 6: Bot activation invariant", () => {
  it("returns true iff count of non-bot participants < 2", () => {
    // Generate a mix of bot and non-bot client IDs
    const botIdArb = fc.string({ minLength: 1, maxLength: 10 }).map(
      (s) => `bot-${s}`
    );
    const realIdArb = fc
      .string({ minLength: 1, maxLength: 10 })
      .filter((s) => !s.startsWith("bot-"));

    const participantsArb = fc.array(
      fc.oneof(botIdArb, realIdArb),
      { minLength: 0, maxLength: 20 }
    );

    fc.assert(
      fc.property(participantsArb, (participants) => {
        const result = shouldBotsBeActive(participants, "bot-");

        // Count real users (those not starting with "bot-")
        const realUserCount = participants.filter(
          (id) => !id.startsWith("bot-")
        ).length;

        // Bot activation: active when fewer than 2 real users
        // The implementation uses <= 1 which is equivalent to < 2
        const expected = realUserCount < 2;
        expect(result).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  it("order of participants does not affect the result", () => {
    const botIdArb = fc.string({ minLength: 1, maxLength: 10 }).map(
      (s) => `bot-${s}`
    );
    const realIdArb = fc
      .string({ minLength: 1, maxLength: 10 })
      .filter((s) => !s.startsWith("bot-"));

    const participantsArb = fc.array(
      fc.oneof(botIdArb, realIdArb),
      { minLength: 1, maxLength: 20 }
    );

    fc.assert(
      fc.property(participantsArb, (participants) => {
        // Shuffle the array
        const shuffled = [...participants].reverse();

        const result1 = shouldBotsBeActive(participants, "bot-");
        const result2 = shouldBotsBeActive(shuffled, "bot-");

        expect(result1).toBe(result2);
      }),
      { numRuns: 100 }
    );
  });
});
