/**
 * Delta computation module for the Collaborative Sync Engine.
 * Computes minimal diffs between two CRDT states, producing only
 * the changed portion needed to bring the previous state up to date.
 */

import type { CRDTState, StateDelta, ItemChange } from "../types/index.js";

/**
 * Computes the minimal delta between two CRDT states.
 *
 * Algorithm:
 * 1. Items in `after` but not in `before` → "added" with all field values.
 * 2. Items in `before` but not in `after` → "removed".
 * 3. Items in both where `removedAt` changed from null to non-null → "removed".
 * 4. Items in both with field differences → "updated" with only changed fields.
 *
 * @param before - The previous CRDT state
 * @param after - The current CRDT state after merge
 * @returns A StateDelta containing only the changes between the two states
 */
export function computeDelta(before: CRDTState, after: CRDTState): StateDelta {
  const changes: ItemChange[] = [];

  // Check items in `after` state
  for (const itemId of Object.keys(after.items)) {
    const afterItem = after.items[itemId];
    const beforeItem = before.items[itemId];

    if (!beforeItem) {
      // Item exists in after but not in before → added
      const fields: Record<string, unknown> = {};
      for (const [fieldName, register] of Object.entries(afterItem.fields)) {
        fields[fieldName] = register.value;
      }
      changes.push({ itemId, type: "added", fields });
    } else {
      // Item exists in both — check for changes
      if (beforeItem.removedAt === null && afterItem.removedAt !== null) {
        // removedAt changed from null to non-null → removed
        changes.push({ itemId, type: "removed" });
      } else {
        // Compare fields for updates
        const changedFields: Record<string, unknown> = {};
        let hasChanges = false;

        // Check all fields in after
        for (const [fieldName, afterRegister] of Object.entries(afterItem.fields)) {
          const beforeRegister = beforeItem.fields[fieldName];

          if (!beforeRegister) {
            // New field added
            changedFields[fieldName] = afterRegister.value;
            hasChanges = true;
          } else if (
            afterRegister.value !== beforeRegister.value ||
            afterRegister.timestamp.wallTime !== beforeRegister.timestamp.wallTime ||
            afterRegister.timestamp.logical !== beforeRegister.timestamp.logical ||
            afterRegister.timestamp.nodeId !== beforeRegister.timestamp.nodeId
          ) {
            // Field value or timestamp changed
            changedFields[fieldName] = afterRegister.value;
            hasChanges = true;
          }
        }

        // Check for fields removed (in before but not in after)
        for (const fieldName of Object.keys(beforeItem.fields)) {
          if (!(fieldName in afterItem.fields)) {
            changedFields[fieldName] = undefined;
            hasChanges = true;
          }
        }

        if (hasChanges) {
          changes.push({ itemId, type: "updated", fields: changedFields });
        }
      }
    }
  }

  // Check items in `before` but not in `after` → removed
  for (const itemId of Object.keys(before.items)) {
    if (!(itemId in after.items)) {
      changes.push({ itemId, type: "removed" });
    }
  }

  return {
    sessionId: after.sessionId,
    changes,
    timestamp: after.lastUpdated,
  };
}
