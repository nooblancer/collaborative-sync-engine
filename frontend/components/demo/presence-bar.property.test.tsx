// Feature: sync-engine-frontend, Property 3: Presence badge displays name
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { render } from "@testing-library/react";
import { PresenceBar } from "./presence-bar";
import type { UserPresence } from "@/lib/types";

/**
 * Validates: Requirements 9.4
 *
 * Property: For any valid UserPresence object with a displayName of 1-100
 * characters, the rendered presence badge SHALL contain that exact displayName text.
 */

// Generator for printable ASCII characters (charCode 32-126)
const arbPrintableChar = fc.char().filter(
  (c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126
);

// Generator for non-space printable ASCII characters (charCode 33-126)
const arbNonSpaceChar = fc.char().filter(
  (c) => c.charCodeAt(0) >= 33 && c.charCodeAt(0) <= 126
);

// Generator for display names: 1-100 printable ASCII characters
// Ensure at least one non-space character so text is findable after DOM normalization
const arbDisplayName = fc
  .tuple(
    fc.stringOf(arbPrintableChar, { minLength: 0, maxLength: 49 }),
    arbNonSpaceChar,
    fc.stringOf(arbPrintableChar, { minLength: 0, maxLength: 49 })
  )
  .map(([prefix, core, suffix]) => {
    const result = `${prefix}${core}${suffix}`;
    return result.slice(0, 100);
  })
  .filter((s) => s.length >= 1 && s.length <= 100);

const arbUserId = fc.string({ minLength: 1, maxLength: 36 });

const arbUserPresence: fc.Arbitrary<UserPresence> = fc.record({
  userId: arbUserId,
  displayName: arbDisplayName,
});

describe("PresenceBar - Property 3: Presence badge displays name", () => {
  it("renders the exact displayName text for any valid UserPresence", () => {
    fc.assert(
      fc.property(arbUserPresence, (user) => {
        const { unmount, container } = render(
          <PresenceBar users={[user]} currentUserId="other-user-id" />
        );

        // Find badge elements and check one contains the exact displayName
        const badges = container.querySelectorAll("[class*='badge'], [class*='rounded-full']");
        const found = Array.from(badges).some(
          (el) => el.textContent === user.displayName
        );
        expect(found).toBe(true);

        unmount();
      }),
      { numRuns: 100 }
    );
  });
});
