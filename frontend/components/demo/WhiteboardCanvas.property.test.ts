/**
 * Property-based tests for bot activation logic.
 *
 * Feature: v2.3-server-benchmark, Property 8: Bot activation iff single real user
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { shouldBotsBeActive } from "./WhiteboardCanvas";

const BOT_PREFIX = "bot-";

// Feature: v2.3-server-benchmark, Property 8: Bot activation iff single real user
describe("Property 8: Bot activation iff single real user", () => {
  /**
   * **Validates: Requirements 3.1, 3.2, 3.3**
   *
   * For any participant list, shouldBotsBeActive SHALL return true if and only if
   * the number of participants whose client ID does NOT start with the bot prefix
   * is less than or equal to 1.
   */
  it("returns true iff real user count <= 1 for any participant list", () => {
    const botIdArb = fc.oneof(
      fc.constant("bot-alice"),
      fc.constant("bot-bob"),
      fc.constant("bot-charlie"),
      fc.constant("bot-drawer-1"),
      fc.constant("bot-alice-simulated")
    );

    const realUserIdArb = fc.oneof(
      fc.constant("user-1"),
      fc.constant("user-2"),
      fc.constant("user-3"),
      fc.constant("client-abc123"),
      fc.constant("real-person-xyz")
    );

    const participantArb = fc.oneof(botIdArb, realUserIdArb);
    const participantListArb = fc.array(participantArb, { minLength: 0, maxLength: 20 });

    fc.assert(
      fc.property(participantListArb, (participants) => {
        const result = shouldBotsBeActive(participants, BOT_PREFIX);

        const realUserCount = participants.filter(
          (id) => !id.startsWith(BOT_PREFIX)
        ).length;

        if (realUserCount <= 1) {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });
});
