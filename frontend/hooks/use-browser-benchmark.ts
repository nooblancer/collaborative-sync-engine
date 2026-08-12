"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { BACKEND_URL, WS_URL } from "@/lib/constants";
import { computePercentile } from "@/lib/benchmark-utils";
import type {
  WsStatus,
  StressMetrics,
  ThroughputSample,
  OperationLogEntry,
} from "@/lib/stress-test-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserBenchmarkState {
  phase: "idle" | "running" | "completed";
  wsStatus: WsStatus;
  metrics: StressMetrics;
  throughputSamples: ThroughputSample[];
  operationLog: OperationLogEntry[];
  progress: number; // 0-100
}

export interface UseBrowserBenchmarkReturn {
  state: BrowserBenchmarkState;
  selectedOps: number;
  setSelectedOps: (ops: number) => void;
  startTest: () => Promise<void>;
  stopTest: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateOperationId(): string {
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateItemId(): string {
  return `item-${Math.random().toString(36).slice(2, 10)}`;
}

const INITIAL_METRICS: StressMetrics = {
  submitted: 0,
  confirmed: 0,
  throughput: 0,
  peakThroughput: 0,
  p50: 0,
  p99: 0,
  elapsed: 0,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook encapsulating the browser-to-server WebSocket burst benchmark.
 *
 * Connects to the WS server, creates a room, sends all operations in burst
 * mode, tracks ACKs with latency measurements, computes live percentiles,
 * and samples throughput every 1 second.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4
 */
export function useBrowserBenchmark(roomId: string): UseBrowserBenchmarkReturn {
  const [state, setState] = useState<BrowserBenchmarkState>({
    phase: "idle",
    wsStatus: "disconnected",
    metrics: INITIAL_METRICS,
    throughputSamples: [],
    operationLog: [],
    progress: 0,
  });
  const [selectedOps, setSelectedOps] = useState<number>(1000);

  // Refs for test execution
  const wsRef = useRef<WebSocket | null>(null);
  const roomIdRef = useRef<string>(roomId);
  const startTimeRef = useRef<number>(0);
  const latenciesRef = useRef<number[]>([]);
  const pendingOpsRef = useRef<Map<number, number>>(new Map());
  const seqRef = useRef<number>(0);
  const confirmedCountRef = useRef<number>(0);
  const submittedCountRef = useRef<number>(0);
  const cancelledRef = useRef<boolean>(false);
  const throughputIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCountRef = useRef<number>(0);

  // Keep roomId ref in sync
  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (throughputIntervalRef.current) {
        clearInterval(throughputIntervalRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // WebSocket connection + room creation
  // ---------------------------------------------------------------------------

  const connectAndCreateRoom = useCallback(async (): Promise<WebSocket> => {
    const userId = `stress-${Date.now().toString(36)}`;
    const displayName = "StressClient";
    const tokenUrl = `${BACKEND_URL}/token?userId=${encodeURIComponent(userId)}&displayName=${encodeURIComponent(displayName)}`;
    const res = await fetch(tokenUrl);
    if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
    const { token } = await res.json();

    const wsUrl = WS_URL.replace(/^http/, "ws");
    const ws = new WebSocket(`${wsUrl}?token=${token}`);

    return new Promise<WebSocket>((resolve, reject) => {
      ws.onopen = () => {
        setState((prev) => ({ ...prev, wsStatus: "reconnecting" }));
      };

      ws.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data);

          // Wait for connected acknowledgment
          if (
            frame.type === "control-response" &&
            frame.payload?.type === "connected"
          ) {
            setState((prev) => ({ ...prev, wsStatus: "connected" }));
            // Send create-room command
            const createRoomId = roomIdRef.current || `stress-room-${Date.now().toString(36)}`;
            roomIdRef.current = createRoomId;
            const createCmd = {
              channel: "control" as const,
              roomId: createRoomId,
              seq: seqRef.current++,
              payload: { type: "create-room" as const },
            };
            ws.send(JSON.stringify(createCmd));
            return;
          }

          // Wait for room-created confirmation
          if (
            frame.type === "control-response" &&
            frame.payload &&
            (frame.payload.type === "create-room" ||
              frame.payload.type === "room-created" ||
              frame.payload.roomId)
          ) {
            if (frame.payload.roomId) {
              roomIdRef.current = frame.payload.roomId;
            }
            resolve(ws);
            return;
          }
        } catch {
          // Ignore parse errors during handshake
        }
      };

      ws.onerror = () => {
        setState((prev) => ({ ...prev, wsStatus: "disconnected" }));
        reject(new Error("WebSocket connection failed"));
      };

      ws.onclose = () => {
        setState((prev) => ({ ...prev, wsStatus: "disconnected" }));
      };
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Operation generation
  // ---------------------------------------------------------------------------

  const generateOperations = useCallback((count: number) => {
    const ops: Array<{
      id: string;
      type: "add" | "update" | "remove";
      displayType: "create" | "update" | "delete";
      itemId: string;
      payload: Record<string, unknown>;
    }> = [];

    const itemIds: string[] = [];

    for (let i = 0; i < count; i++) {
      const roll = Math.random();
      let type: "add" | "update" | "remove";
      let displayType: "create" | "update" | "delete";
      let itemId: string;

      if (roll < 0.4 || itemIds.length === 0) {
        type = "add";
        displayType = "create";
        itemId = generateItemId();
        itemIds.push(itemId);
      } else if (roll < 0.85) {
        type = "update";
        displayType = "update";
        itemId = itemIds[Math.floor(Math.random() * itemIds.length)];
      } else {
        type = "remove";
        displayType = "delete";
        const idx = Math.floor(Math.random() * itemIds.length);
        itemId = itemIds[idx];
        itemIds.splice(idx, 1);
        if (itemIds.length === 0) itemIds.push(generateItemId());
      }

      ops.push({
        id: generateOperationId(),
        type,
        displayType,
        itemId,
        payload:
          displayType === "create"
            ? { name: `Item-${i}`, quantity: Math.floor(Math.random() * 1000) }
            : displayType === "update"
              ? { quantity: Math.floor(Math.random() * 1000) }
              : {},
      });
    }

    return ops;
  }, []);

  // ---------------------------------------------------------------------------
  // Message handler setup (ACK tracking)
  // ---------------------------------------------------------------------------

  const setupMessageHandler = useCallback((ws: WebSocket) => {
    ws.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data);

        // Handle ping/pong
        if (frame.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }

        // Handle ACK — track confirmed operations
        if (frame.type === "ack" && frame.replyTo !== undefined) {
          const sentAt = pendingOpsRef.current.get(frame.replyTo);
          if (sentAt) {
            const latency = performance.now() - sentAt;
            latenciesRef.current.push(latency);
            pendingOpsRef.current.delete(frame.replyTo);
            confirmedCountRef.current++;
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Start test
  // ---------------------------------------------------------------------------

  const startTest = useCallback(async () => {
    // Prevent concurrent runs
    if (state.phase === "running") return;

    // Reset state
    cancelledRef.current = false;
    confirmedCountRef.current = 0;
    submittedCountRef.current = 0;
    latenciesRef.current = [];
    pendingOpsRef.current.clear();
    seqRef.current = 0;
    lastCountRef.current = 0;

    setState({
      phase: "running",
      wsStatus: "disconnected",
      metrics: INITIAL_METRICS,
      throughputSamples: [],
      operationLog: [],
      progress: 0,
    });

    try {
      const ws = await connectAndCreateRoom();
      wsRef.current = ws;
      setupMessageHandler(ws);

      // Generate all operations upfront
      const operations = generateOperations(selectedOps);
      startTimeRef.current = performance.now();

      // Start throughput sampling every 1s
      throughputIntervalRef.current = setInterval(() => {
        const currentConfirmed = confirmedCountRef.current;
        const delta = currentConfirmed - lastCountRef.current;
        lastCountRef.current = currentConfirmed;

        const sample: ThroughputSample = {
          timestamp: Date.now(),
          opsPerSec: delta,
        };

        setState((prev) => {
          const newSamples = [...prev.throughputSamples.slice(-59), sample];
          return {
            ...prev,
            throughputSamples: newSamples,
            metrics: {
              ...prev.metrics,
              throughput: delta,
              peakThroughput: Math.max(prev.metrics.peakThroughput, delta),
            },
          };
        });
      }, 1000);

      // Send all operations immediately (burst mode)
      for (let i = 0; i < operations.length; i++) {
        if (cancelledRef.current) break;

        const op = operations[i];
        const seq = seqRef.current++;
        const frame = {
          channel: "ops",
          roomId: roomIdRef.current,
          seq,
          payload: {
            id: op.id,
            type: op.type,
            itemId: op.itemId,
            payload: op.payload,
            timestamp: {
              wallTime: Date.now(),
              logical: i,
              nodeId: "stress-node",
            },
            version: 1,
          },
        };

        pendingOpsRef.current.set(seq, performance.now());
        ws.send(JSON.stringify(frame));
        submittedCountRef.current++;

        // Add to operation log (keep last 100 entries)
        const logEntry: OperationLogEntry = {
          id: op.id,
          type: op.displayType,
          timestamp: Date.now(),
          status: "submitted",
        };

        // Update state periodically to avoid excessive re-renders
        if (i % 10 === 0 || i === operations.length - 1) {
          setState((prev) => {
            const newLog = [...prev.operationLog.slice(-99), logEntry];
            return {
              ...prev,
              metrics: {
                ...prev.metrics,
                submitted: submittedCountRef.current,
              },
              operationLog: newLog,
              progress: Math.min(
                100,
                Math.round((confirmedCountRef.current / selectedOps) * 100)
              ),
            };
          });
        }
      }

      // Wait for all confirmations (timeout after 15s)
      const waitStart = Date.now();
      while (
        confirmedCountRef.current < submittedCountRef.current &&
        Date.now() - waitStart < 15000 &&
        !cancelledRef.current
      ) {
        await new Promise((r) => setTimeout(r, 50));

        const sorted = [...latenciesRef.current].sort((a, b) => a - b);
        const progress = Math.min(
          100,
          Math.round((confirmedCountRef.current / selectedOps) * 100)
        );

        setState((prev) => {
          // Update operation log entries from submitted → confirmed
          const updatedLog = prev.operationLog.map((entry) =>
            entry.status === "submitted" &&
            confirmedCountRef.current >
              prev.operationLog.filter((e) => e.status === "confirmed").length
              ? { ...entry, status: "confirmed" as const }
              : entry
          );

          return {
            ...prev,
            metrics: {
              ...prev.metrics,
              confirmed: confirmedCountRef.current,
              elapsed: performance.now() - startTimeRef.current,
              p50: computePercentile(sorted, 0.5),
              p99: computePercentile(sorted, 0.99),
            },
            operationLog: updatedLog,
            progress,
          };
        });
      }

      // Completion
      const totalElapsed = performance.now() - startTimeRef.current;
      const sorted = [...latenciesRef.current].sort((a, b) => a - b);

      if (throughputIntervalRef.current) {
        clearInterval(throughputIntervalRef.current);
        throughputIntervalRef.current = null;
      }

      setState((prev) => ({
        ...prev,
        phase: "completed",
        metrics: {
          ...prev.metrics,
          submitted: submittedCountRef.current,
          confirmed: confirmedCountRef.current,
          elapsed: totalElapsed,
          p50: computePercentile(sorted, 0.5),
          p99: computePercentile(sorted, 0.99),
          throughput:
            totalElapsed > 0
              ? Math.round((confirmedCountRef.current / totalElapsed) * 1000)
              : 0,
        },
        progress: Math.min(
          100,
          Math.round((confirmedCountRef.current / selectedOps) * 100)
        ),
      }));
    } catch (err) {
      console.error("Browser benchmark error:", err);
      setState((prev) => ({
        ...prev,
        phase: "idle",
        wsStatus: "disconnected",
      }));
    }
  }, [state.phase, selectedOps, connectAndCreateRoom, setupMessageHandler, generateOperations]);

  // ---------------------------------------------------------------------------
  // Stop test
  // ---------------------------------------------------------------------------

  const stopTest = useCallback(() => {
    cancelledRef.current = true;

    if (throughputIntervalRef.current) {
      clearInterval(throughputIntervalRef.current);
      throughputIntervalRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setState((prev) => ({
      ...prev,
      phase: "completed",
      wsStatus: "disconnected",
    }));
  }, []);

  return {
    state,
    selectedOps,
    setSelectedOps,
    startTest,
    stopTest,
  };
}
