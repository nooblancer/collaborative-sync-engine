"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "@/lib/types";
import { RECONNECT_DELAY_MS, WS_URL } from "@/lib/constants";

export interface UseWebSocketReturn {
  status: "connected" | "disconnected" | "reconnecting";
  sendMessage: (message: ClientMessage) => void;
  lastMessage: ServerMessage | null;
  subscribe: (
    type: ServerMessage["type"],
    handler: (msg: ServerMessage) => void
  ) => () => void;
}

function getOrCreateSessionIdentity(): {
  userId: string;
  displayName: string;
} {
  const storageKey = "sync-engine-user-identity";

  if (typeof window !== "undefined") {
    const stored = sessionStorage.getItem(storageKey);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Fall through to generate new identity
      }
    }
  }

  const userId = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const adjectives = ["Swift", "Bright", "Calm", "Bold", "Keen"];
  const nouns = ["Fox", "Owl", "Bear", "Wolf", "Hawk"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const displayName = `${adj}${noun}${Math.floor(Math.random() * 100)}`;

  const identity = { userId, displayName };

  if (typeof window !== "undefined") {
    sessionStorage.setItem(storageKey, JSON.stringify(identity));
  }

  return identity;
}

export function useWebSocket(backendUrl: string): UseWebSocketReturn {
  const [status, setStatus] = useState<UseWebSocketReturn["status"]>("disconnected");
  const [lastMessage, setLastMessage] = useState<ServerMessage | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const subscribersRef = useRef<
    Map<ServerMessage["type"], Set<(msg: ServerMessage) => void>>
  >(new Map());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const sendMessage = useCallback((message: ClientMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const subscribe = useCallback(
    (
      type: ServerMessage["type"],
      handler: (msg: ServerMessage) => void
    ): (() => void) => {
      if (!subscribersRef.current.has(type)) {
        subscribersRef.current.set(type, new Set());
      }
      subscribersRef.current.get(type)!.add(handler);

      return () => {
        const handlers = subscribersRef.current.get(type);
        if (handlers) {
          handlers.delete(handler);
          if (handlers.size === 0) {
            subscribersRef.current.delete(type);
          }
        }
      };
    },
    []
  );

  useEffect(() => {
    mountedRef.current = true;

    const identity = getOrCreateSessionIdentity();

    async function connect() {
      try {
        const tokenUrl = `${backendUrl}/token?userId=${encodeURIComponent(identity.userId)}&displayName=${encodeURIComponent(identity.displayName)}`;
        const response = await fetch(tokenUrl);

        if (!response.ok) {
          throw new Error(`Token fetch failed: ${response.status}`);
        }

        const data = await response.json();
        const token = data.token;

        if (!mountedRef.current) return;

        const wsUrl = WS_URL.replace(/^http/, "ws");
        const ws = new WebSocket(`${wsUrl}?token=${token}`);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mountedRef.current) return;
          setStatus("connected");
        };

        ws.onmessage = (event) => {
          if (!mountedRef.current) return;

          let message: ServerMessage;
          try {
            message = JSON.parse(event.data);
          } catch {
            // Silently ignore malformed messages
            return;
          }

          // Auto-respond to ping with pong
          if (message.type === "ping") {
            sendMessage({ type: "pong" });
          }

          // Dispatch to subscribers
          const handlers = subscribersRef.current.get(message.type);
          if (handlers) {
            handlers.forEach((handler) => handler(message));
          }

          // Update lastMessage
          setLastMessage(message);
        };

        ws.onclose = () => {
          if (!mountedRef.current) return;
          wsRef.current = null;
          setStatus("reconnecting");
          scheduleReconnect();
        };

        ws.onerror = () => {
          // onclose will be called after onerror, so we handle reconnect there
        };
      } catch {
        if (!mountedRef.current) return;
        setStatus("reconnecting");
        scheduleReconnect();
      }
    }

    function scheduleReconnect() {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          connect();
        }
      }, RECONNECT_DELAY_MS);
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
  }, [backendUrl, sendMessage]);

  return { status, sendMessage, lastMessage, subscribe };
}
