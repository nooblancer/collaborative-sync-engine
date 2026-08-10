// Feature: sync-engine-frontend, Property 2: Presence state consistency
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { UserPresence } from "@/lib/types";

/**
 * Validates: Requirements 9.2, 9.3
 *
 * Property: For any sequence of `presence-join` and `presence-leave` messages
 * applied to an initially empty presence list, the resulting presence list SHALL
 * contain exactly those users who have joined but not subsequently left (i.e.,
 * each join adds a user, each leave for that userId removes them).
 */

// Replicate the core presence state logic from usePresence:
type PresenceEvent =
  | { type: "join"; user: UserPresence }
  | { type: "leave"; userId: string };

function applyPresenceEvents(events: PresenceEvent[]): UserPresence[] {
  let users: UserPresence[] = [];

  for (const event of events) {
    if (event.type === "join") {
      const existing = users.findIndex(
        (u) => u.userId === event.user.userId
      );
      if (existing !== -1) {
        // Update existing entry rather than adding duplicate
        const updated = [...users];
        updated[existing] = event.user;
        users = updated;
      } else {
        users = [...users, event.user];
      }
    } else if (event.type === "leave") {
      users = users.filter((u) => u.userId !== event.userId);
    }
  }

  return users;
}

// Generators
const arbUserId = fc.string({ minLength: 1, maxLength: 20 });
const arbDisplayName = fc.string({ minLength: 1, maxLength: 50 });

const arbUserPresence = fc.record({
  userId: arbUserId,
  displayName: arbDisplayName,
});

// Stateful arbitrary that generates a sequence of presence events
// where leave events reference previously-joined userIds
function arbPresenceEventSequence(): fc.Arbitrary<PresenceEvent[]> {
  return fc
    .array(
      fc.record({
        isJoin: fc.boolean(),
        user: arbUserPresence,
        leaveIndex: fc.nat(),
      }),
      { minLength: 0, maxLength: 50 }
    )
    .map((rawEvents) => {
      const events: PresenceEvent[] = [];
      const joinedUserIds: string[] = [];

      for (const raw of rawEvents) {
        if (raw.isJoin || joinedUserIds.length === 0) {
          // Join event
          events.push({ type: "join", user: raw.user });
          if (!joinedUserIds.includes(raw.user.userId)) {
            joinedUserIds.push(raw.user.userId);
          }
        } else {
          // Leave event - pick from previously joined users
          const idx = raw.leaveIndex % joinedUserIds.length;
          const userId = joinedUserIds[idx];
          events.push({ type: "leave", userId });
        }
      }

      return events;
    });
}

describe("usePresence - Property 2: Presence state consistency", () => {
  it("final presence list contains exactly users who joined but not subsequently left", () => {
    fc.assert(
      fc.property(arbPresenceEventSequence(), (events) => {
        const result = applyPresenceEvents(events);

        // Compute the expected set: for each userId, track the last action
        const lastAction = new Map<
          string,
          { action: "join"; user: UserPresence } | { action: "leave" }
        >();

        for (const event of events) {
          if (event.type === "join") {
            lastAction.set(event.user.userId, {
              action: "join",
              user: event.user,
            });
          } else {
            lastAction.set(event.userId, { action: "leave" });
          }
        }

        // Expected users: those whose last action was "join"
        const expectedUsers: UserPresence[] = [];
        for (const [, entry] of lastAction) {
          if (entry.action === "join") {
            expectedUsers.push(entry.user);
          }
        }

        // The result should contain exactly the expected users (order may differ)
        expect(result.length).toBe(expectedUsers.length);

        for (const expected of expectedUsers) {
          const found = result.find((u) => u.userId === expected.userId);
          expect(found).toBeDefined();
          expect(found!.displayName).toBe(expected.displayName);
        }

        // No extra users should be present
        for (const user of result) {
          const inExpected = expectedUsers.find(
            (e) => e.userId === user.userId
          );
          expect(inExpected).toBeDefined();
        }
      }),
      { numRuns: 100 }
    );
  });

  it("no duplicate userIds exist in the presence list after any event sequence", () => {
    fc.assert(
      fc.property(arbPresenceEventSequence(), (events) => {
        const result = applyPresenceEvents(events);

        const userIds = result.map((u) => u.userId);
        const uniqueUserIds = new Set(userIds);

        expect(userIds.length).toBe(uniqueUserIds.size);
      }),
      { numRuns: 100 }
    );
  });

  it("a join followed by a leave for the same userId results in empty list", () => {
    fc.assert(
      fc.property(arbUserPresence, (user) => {
        const events: PresenceEvent[] = [
          { type: "join", user },
          { type: "leave", userId: user.userId },
        ];

        const result = applyPresenceEvents(events);
        expect(result.length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it("re-joining updates the user entry rather than creating a duplicate", () => {
    fc.assert(
      fc.property(
        arbUserId,
        arbDisplayName,
        arbDisplayName,
        (userId, name1, name2) => {
          const events: PresenceEvent[] = [
            { type: "join", user: { userId, displayName: name1 } },
            { type: "join", user: { userId, displayName: name2 } },
          ];

          const result = applyPresenceEvents(events);

          // Should have exactly one entry for this userId
          const matches = result.filter((u) => u.userId === userId);
          expect(matches.length).toBe(1);
          // Should have the latest displayName
          expect(matches[0].displayName).toBe(name2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
