/**
 * Concurrent Rooms Benchmark Runner.
 *
 * Uses optimized `mergeBatchBenchmark` per room for O(n) processing.
 * Creates N independent CRDT states, distributes operations across rooms,
 * processes each room with a single optimized Rust call.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */

import path from "path";
import { MemorySampler } from "./memory-sampler.js";

// Load the native merge addon
const nativeMergePath = path.join(__dirname, "..", "native-merge", "native-merge.node");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeMerge = require(nativeMergePath) as {
  mergeBatchBenchmark: (state: Buffer, operations: Buffer[]) => Buffer;
};

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface RoomMetrics {
  roomIndex: number;
  ops: number;
  elapsedMs: number;
  opsPerSecond: number;
}

export interface RoomsBenchmarkResponse {
  mode: "rooms";
  totalOps: number;
  elapsedMs: number;
  opsPerSecond: number;
  p50Ms: number;
  p99Ms: number;
  batchesProcessed: number;
  mergeEngine: "rust-napi-rs";
  timestamp: string;
  memoryPeakMb: number | null;
  memoryDeltaMb: number | null;
  memoryError?: string;
  roomCount: number;
  perRoom: RoomMetrics[];
  slowestRoomMs: number;
  fastestRoomMs: number;
  averageRoomMs: number;
}

export interface RoomsBenchmarkError {
  error: string;
  mode: "rooms";
  opsCompleted?: number;
}

// ---------------------------------------------------------------------------
// Workload Generator
// ---------------------------------------------------------------------------

function generateRoomWorkload(ops: number, roomIndex: number): Buffer[] {
  const operations: Buffer[] = new Array(ops);
  const baseTime = Date.now();
  const replicaId = `room-${roomIndex}-node`;
  const sessionId = `benchmark-room-${roomIndex}`;
  let itemCounter = 0;

  for (let i = 0; i < ops; i++) {
    let type: "add" | "update" | "remove";
    let itemId: string;

    const typeIdx = i % 20;
    if (typeIdx < 10 || itemCounter === 0) {
      type = "add";
      itemId = `r${roomIndex}-${itemCounter++}`;
    } else if (typeIdx < 17) {
      type = "update";
      itemId = `r${roomIndex}-${i % Math.max(1, itemCounter)}`;
    } else {
      type = "remove";
      itemId = `r${roomIndex}-${i % Math.max(1, itemCounter)}`;
    }

    operations[i] = Buffer.from(
      `{"id":"op-${i}","sessionId":"${sessionId}","replicaId":"${replicaId}","type":"${type}","itemId":"${itemId}","payload":${type === "remove" ? "{}" : `{"n":${i}}`},"timestamp":{"wallTime":${baseTime + i},"logical":${i},"nodeId":"${replicaId}"},"version":${i + 1}}`
    );
  }

  return operations;
}

// ---------------------------------------------------------------------------
// Benchmark Runner
// ---------------------------------------------------------------------------

export function runRoomsBenchmark(
  ops: number,
  batchSize: number,
  rooms: number
): RoomsBenchmarkResponse | RoomsBenchmarkError {
  const opsPerRoom = Math.floor(ops / rooms);
  const roomOps: number[] = [];
  for (let i = 0; i < rooms - 1; i++) roomOps.push(opsPerRoom);
  roomOps.push(opsPerRoom + (ops % rooms));

  const memorySampler = new MemorySampler();
  memorySampler.recordBaseline();

  const perRoomMetrics: RoomMetrics[] = [];
  const roomDurationsNs: bigint[] = [];

  const overallStart = process.hrtime.bigint();

  for (let roomIndex = 0; roomIndex < rooms; roomIndex++) {
    const roomOpCount = roomOps[roomIndex];
    const roomOperations = generateRoomWorkload(roomOpCount, roomIndex);

    const initialState = Buffer.from(JSON.stringify({
      sessionId: `benchmark-room-${roomIndex}`,
      items: {},
      version: 0,
      lastUpdated: { wallTime: 0, logical: 0, nodeId: `room-${roomIndex}-node` },
    }));

    const roomStart = process.hrtime.bigint();
    nativeMerge.mergeBatchBenchmark(initialState, roomOperations);
    const roomEnd = process.hrtime.bigint();

    const roomDurationNs = roomEnd - roomStart;
    roomDurationsNs.push(roomDurationNs);
    const roomElapsedMs = Number(roomDurationNs) / 1_000_000;

    perRoomMetrics.push({
      roomIndex,
      ops: roomOpCount,
      elapsedMs: roomElapsedMs,
      opsPerSecond: roomOpCount / (roomElapsedMs / 1000),
    });

    memorySampler.sample();
  }

  const overallEnd = process.hrtime.bigint();
  const elapsedMs = Number(overallEnd - overallStart) / 1_000_000;

  const roomTimes = perRoomMetrics.map((r) => r.elapsedMs);
  const slowestRoomMs = Math.max(...roomTimes);
  const fastestRoomMs = Math.min(...roomTimes);
  const averageRoomMs = roomTimes.reduce((sum, t) => sum + t, 0) / roomTimes.length;

  const sortedDurations = [...roomDurationsNs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const p50Ms = Number(sortedDurations[Math.floor(sortedDurations.length * 0.5)]) / 1_000_000;
  const p99Ms = Number(sortedDurations[Math.min(sortedDurations.length - 1, Math.floor(sortedDurations.length * 0.99))]) / 1_000_000;

  const memoryResults = memorySampler.getResults();

  const response: RoomsBenchmarkResponse = {
    mode: "rooms",
    totalOps: ops,
    elapsedMs,
    opsPerSecond: ops / (elapsedMs / 1000),
    p50Ms,
    p99Ms,
    batchesProcessed: rooms,
    mergeEngine: "rust-napi-rs",
    timestamp: new Date().toISOString(),
    memoryPeakMb: memoryResults.memoryPeakMb,
    memoryDeltaMb: memoryResults.memoryDeltaMb,
    roomCount: rooms,
    perRoom: perRoomMetrics,
    slowestRoomMs,
    fastestRoomMs,
    averageRoomMs,
  };

  if (memoryResults.memoryError) {
    response.memoryError = memoryResults.memoryError;
  }

  return response;
}
