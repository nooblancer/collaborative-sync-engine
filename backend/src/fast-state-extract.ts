/**
 * Fast state extraction from BatchMergeResult JSON buffers.
 *
 * Instead of JSON.parse on the entire multi-megabyte result buffer,
 * we find the "state": key and extract just that portion. This avoids
 * allocating/parsing the finalDelta, changes arrays, and other metadata
 * that aren't needed between batch iterations.
 *
 * For a 10MB BatchMergeResult, this is ~100x faster than full JSON.parse
 * because we only scan for the marker position, then slice.
 */

/**
 * Extracts the state JSON from a BatchMergeResult buffer without full parsing.
 * The state is always the last top-level key in the serde_json output:
 * {"totalReceived":...,"merged":...,"failed":[...],"finalDelta":{...},"state":{...}}
 *
 * We find `"state":` and extract everything from there to the end minus the trailing `}`.
 */
export function extractStateBuffer(resultBuffer: Buffer): Buffer {
  // Find "state": marker in the buffer
  const marker = Buffer.from('"state":');
  const idx = resultBuffer.indexOf(marker);

  if (idx === -1) {
    // Fallback: full parse if marker not found (shouldn't happen)
    const parsed = JSON.parse(resultBuffer.toString()) as { state: unknown };
    return Buffer.from(JSON.stringify(parsed.state));
  }

  // The state value starts at idx + marker.length and goes to resultBuffer.length - 1
  // (the last byte is the closing `}` of the outer object)
  const stateStart = idx + marker.length;
  const stateEnd = resultBuffer.length - 1; // exclude trailing `}`

  return resultBuffer.subarray(stateStart, stateEnd) as Buffer;
}

/**
 * Extracts conflict resolution count from BatchMergeResult without full parsing.
 * Counts occurrences of "type":"updated" in the finalDelta.changes array.
 */
export function extractConflictCount(resultBuffer: Buffer): number {
  // Fast: count occurrences of the pattern in the buffer
  const pattern = Buffer.from('"type":"updated"');
  let count = 0;
  let offset = 0;

  while (true) {
    const idx = resultBuffer.indexOf(pattern, offset);
    if (idx === -1) break;
    count++;
    offset = idx + pattern.length;
  }

  return count;
}

/**
 * Extracts just the item count from a state buffer without full parsing.
 * Counts top-level keys in the "items" object.
 */
export function extractItemCount(stateBuffer: Buffer): number {
  // Parse only the state (which is much smaller than the full result with deltas)
  const state = JSON.parse(stateBuffer.toString()) as { items: Record<string, unknown> };
  return Object.keys(state.items).length;
}
