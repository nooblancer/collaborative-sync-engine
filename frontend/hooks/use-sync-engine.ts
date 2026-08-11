"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * V2 Wire Protocol types for channel-multiplexed WebSocket communication.
 */
export type ChannelType = "ops" | "awareness" | "metrics" | "control";

export interface ClientFrame {
  channel: ChannelType;
  roomId: string;
  seq: number;
  payload: Record<string, unknown>;
}

export interface ServerFrame {
  channel: ChannelType;
  roomId: string;
  type: string;
  payload: unknown;
  replyTo?: number;
}

export interface PerformanceMetrics {
  opsPerSecond: number;
  throughputHistory: number[];
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  activeConnections: number;
  activeRooms: number;
  totalOpsProcessed: number;
}

export type ConnectionState = "connected" | "disconnected" | "reconnecting";

export interface UseSyncEngineReturn {
  connectionState: ConnectionState;
  metrics: PerformanceMetrics | null;
  sendOperation: (roomId: string, operation: Record<string, unknown>) => void;
  sendControl: (roomId: string, command: Record<string, unknown>) => void;
  subscribe: (channel: ChannelType, handler: (frame: ServerFrame) => void) => () => void;
}

const SYNC_URL = process.env.NEXT_PUBLIC_SYNC_URL || "ws://localhost:8080";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 10000;

/**
 * Hook for connecting to the Sync Engine V2 backend via WebSocket
 * with channel multiplexing support.
 */
export function useSyncEngine(): UseSyncEngineReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);
  const subscribersRef = useRef<Map<ChannelType, Set<(frame: ServerFrame) => void>>>(new Map());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const mountedRef = useRef(true);

  const sendFrame = useCallback((frame: ClientFrame) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(frame));
    }
  }, []);

  const sendOperation = useCallback((roomId: string, operation: Record<string, unknown>) => {
    seqRef.current += 1;
    const frame: ClientFrame = {
      channel: "ops",
      roomId,
      seq: seqRef.current,
      payload: operation,
    };
    sendFrame(frame);
  }, [sendFrame]);

  const sendControl = useCallback((roomId: string, command: Record<string, unknown>) => {
    seqRef.current += 1;
    const frame: ClientFrame = {
      channel: "control",
      roomId,
      seq: seqRef.current,
      payload: command,
    };
    sendFrame(frame);
  }, [sendFrame]);

  const subscribe = useCallback(
    (channel: ChannelType, handler: (frame: ServerFrame) => void): (() => void) => {
      if (!subscribersRef.current.has(channel)) {
        subscribersRef.current.set(channel, new Set());
      }
      subscribersRef.current.get(channel)!.add(handler);

      return () => {
        const handlers = subscribersRef.current.get(channel);
        if (handlers) {
          handlers.delete(handler);
          if (handlers.size === 0) {
            subscribersRef.current.delete(channel);
          }
        }
      };
    },
    []
  );

  useEffect(() => {
    mountedRef.current = true;

    async function connect() {
      try {
        // Derive HTTP URL from WebSocket URL for token endpoint
        const httpUrl = SYNC_URL.replace(/^ws/, "http");
        const userId = `hero-visitor-${Date.now().toString(36)}`;
        const displayName = "Visitor";
        const tokenUrl = `${httpUrl}/token?userId=${encodeURIComponent(userId)}&displayName=${encodeURIComponent(displayName)}&roomId=hero-demo`;

        const response = await fetch(tokenUrl);
        if (!response.ok) {
          throw new Error(`Token fetch failed: ${response.status}`);
        }

        const data = await response.json();
        const token = data.token;

        if (!mountedRef.current) return;

        const ws = new WebSocket(`${SYNC_URL}?token=${token}`);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mountedRef.current) return;
          setConnectionState("connected");
          reconnectAttemptRef.current = 0;

          // Join the hero demo room
          seqRef.current += 1;
          const joinFrame: ClientFrame = {
            channel: "control",
            roomId: "hero-demo",
            seq: seqRef.current,
            payload: { type: "create-room" },
          };
          ws.send(JSON.stringify(joinFrame));

          // Subscribe to metrics
          seqRef.current += 1;
          const metricsFrame: ClientFrame = {
            channel: "control",
            roomId: "hero-demo",
            seq: seqRef.current,
            payload: { type: "subscribe-metrics" },
          };
          ws.send(JSON.stringify(metricsFrame));
        };

        ws.onmessage = (event) => {
          if (!mountedRef.current) return;

          let frame: ServerFrame;
          try {
            frame = JSON.parse(event.data);
          } catch {
            return;
          }

          // Dispatch to channel subscribers
          const handlers = subscribersRef.current.get(frame.channel);
          if (handlers) {
            handlers.forEach((handler) => handler(frame));
          }

          // Auto-update metrics state
          if (frame.channel === "metrics" && frame.type === "metrics-snapshot") {
            setMetrics(frame.payload as PerformanceMetrics);
          }
        };

        ws.onclose = () => {
          if (!mountedRef.current) return;
          wsRef.current = null;
          setConnectionState("reconnecting");
          scheduleReconnect();
        };

        ws.onerror = () => {
          // onclose will fire after error
        };
      } catch {
        if (!mountedRef.current) return;
        setConnectionState("reconnecting");
        scheduleReconnect();
      }
    }

    function scheduleReconnect() {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, reconnectAttemptRef.current),
        RECONNECT_MAX_MS
      );
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          connect();
        }
      }, delay);
    }

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return { connectionState, metrics, sendOperation, sendControl, subscribe };
}
