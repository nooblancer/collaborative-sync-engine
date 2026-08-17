"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { BACKEND_URL, WS_URL } from "@/lib/constants";
import type { Collaborator, Participant } from "@/lib/excalidraw-sync-utils";

// --- Scene Merge ---
// Merges remote elements into local scene:
// - Remote elements that don't exist locally → added
// - Remote elements that exist locally → remote wins if version is higher
// - Local elements that don't exist in remote → kept (they're local-only, not yet synced)
function mergeScenes(
  local: ExcalidrawElement[],
  remote: ExcalidrawElement[]
): ExcalidrawElement[] {
  const merged = new Map<string, ExcalidrawElement>();

  // Start with all local elements
  for (const el of local) {
    merged.set(el.id, el);
  }

  // Merge remote elements: add new ones, update existing ONLY if remote version is strictly higher
  for (const remoteEl of remote) {
    const localEl = merged.get(remoteEl.id);
    if (!localEl) {
      // New element from remote — add it
      merged.set(remoteEl.id, remoteEl);
    } else {
      // Element exists in both — remote wins ONLY if version is strictly higher
      // Equal or lower version = keep local (user's active work takes priority)
      const remoteVer = (remoteEl as any).version || 0;
      const localVer = (localEl as any).version || 0;
      if (remoteVer > localVer) {
        merged.set(remoteEl.id, remoteEl);
      }
    }
  }

  // Handle deletions: if remote has element with isDeleted=true that local has as active
  for (const remoteEl of remote) {
    if ((remoteEl as any).isDeleted) {
      const localEl = merged.get(remoteEl.id);
      if (localEl && !(localEl as any).isDeleted) {
        merged.set(remoteEl.id, remoteEl);
      }
    }
  }

  return Array.from(merged.values());
}

// --- Constants ---

const CURSOR_COLORS = [
  "#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3",
  "#54a0ff", "#5f27cd",
];

// --- Session Identity ---

function getSessionIdentity(): { userId: string; displayName: string; color: string } {
  const key = "whiteboard-user-identity";
  if (typeof window !== "undefined") {
    const stored = sessionStorage.getItem(key);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        /* regenerate */
      }
    }
  }
  const userId = `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const names = ["Swift", "Bright", "Calm", "Bold", "Keen", "Quick"];
  const nouns = ["Fox", "Owl", "Bear", "Wolf", "Hawk", "Deer"];
  const displayName = `${names[Math.floor(Math.random() * names.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}${Math.floor(Math.random() * 100)}`;
  const color = CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];
  const identity = { userId, displayName, color };
  if (typeof window !== "undefined") {
    sessionStorage.setItem(key, JSON.stringify(identity));
  }
  return identity;
}

// --- Exponential Backoff ---

export function computeBackoffDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 30000);
}

// --- Stale Cursor Pruning ---

export function pruneStaleCursors(
  cursors: Map<string, { lastUpdate: number }>,
  now: number
): Map<string, { lastUpdate: number }> {
  const pruned = new Map<string, { lastUpdate: number }>();
  for (const [key, value] of cursors) {
    if (now - value.lastUpdate < 5000) {
      pruned.set(key, value);
    }
  }
  return pruned;
}

// --- Interfaces ---

export interface UseExcalidrawSyncOptions {
  roomId: string;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  enabled?: boolean;
}

export interface UseExcalidrawSyncReturn {
  connectionStatus: "connected" | "disconnected" | "reconnecting";
  collaborators: Map<string, Collaborator>;
  participants: Participant[];
  handleLocalChange: (elements: readonly ExcalidrawElement[]) => void;
  sendAwareness: (payload: { pointer: { x: number; y: number }; button: string }) => void;
}

// --- Hook: Full-Scene Broadcast Sync ---

export function useExcalidrawSync({
  roomId,
  excalidrawAPI,
  enabled = true,
}: UseExcalidrawSyncOptions): UseExcalidrawSyncReturn {
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "disconnected" | "reconnecting"
  >("disconnected");
  const [collaborators, setCollaborators] = useState<Map<string, Collaborator>>(
    () => new Map()
  );
  const [participants, setParticipants] = useState<Participant[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);
  const mountedRef = useRef(true);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identityRef = useRef(getSessionIdentity());
  const excalidrawAPIRef = useRef(excalidrawAPI);
  excalidrawAPIRef.current = excalidrawAPI;

  // Debounce timer for scene sync
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Flag to prevent echo (don't re-send scene we just received)
  const suppressRef = useRef(false);
  // Flag: user is actively interacting (don't apply remote changes that could disrupt)
  const userActiveRef = useRef(false);
  const userActiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Send Raw WebSocket Frame ---

  const sendRaw = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  // --- Full Scene Broadcast ---

  const broadcastScene = useCallback(
    (elements: readonly ExcalidrawElement[]) => {
      // Only send non-deleted elements to reduce payload size
      const liveElements = elements.filter((el) => !el.isDeleted);
      seqRef.current++;
      sendRaw({
        channel: "ops",
        roomId,
        seq: seqRef.current,
        payload: {
          id: `scene-${Date.now().toString(36)}`,
          type: "add",
          itemId: "__scene__",
          payload: { scene: liveElements },
          timestamp: {
            wallTime: Date.now(),
            logical: 0,
            nodeId: identityRef.current.userId,
          },
          version: 1,
        },
      });
    },
    [roomId, sendRaw]
  );

  // --- Handle Local Change (debounced full-scene broadcast) ---

  const handleLocalChange = useCallback(
    (elements: readonly ExcalidrawElement[]) => {
      if (suppressRef.current) return;
      // Mark user as active (blocks incoming merges temporarily)
      userActiveRef.current = true;
      if (userActiveTimerRef.current) clearTimeout(userActiveTimerRef.current);
      userActiveTimerRef.current = setTimeout(() => {
        userActiveRef.current = false;
      }, 300);
      // Debounce: send 200ms after user stops changing
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        broadcastScene(elements);
      }, 200);
    },
    [broadcastScene]
  );

  // --- Send Cursor Awareness ---

  const sendAwareness = useCallback(
    (payload: { pointer: { x: number; y: number }; button: string }) => {
      seqRef.current++;
      sendRaw({
        channel: "awareness",
        roomId,
        seq: seqRef.current,
        payload: {
          clientId: identityRef.current.userId,
          cursor: payload.pointer,
          displayName: identityRef.current.displayName,
          color: identityRef.current.color,
        },
      });
    },
    [roomId, sendRaw]
  );

  // --- WebSocket Connection ---

  useEffect(() => {
    if (!enabled) {
      setConnectionStatus("disconnected");
      return;
    }

    mountedRef.current = true;

    async function connect() {
      try {
        const { userId, displayName } = identityRef.current;
        const resp = await fetch(
          `${BACKEND_URL}/token?userId=${encodeURIComponent(userId)}&displayName=${encodeURIComponent(displayName)}&roomId=${encodeURIComponent(roomId)}`
        );
        if (!resp.ok) throw new Error("Token fetch failed");
        const { token } = await resp.json();
        if (!mountedRef.current) return;

        const ws = new WebSocket(`${WS_URL}?token=${token}`);
        wsRef.current = ws;
        let gotAck = false;

        ws.onopen = () => {
          reconnectAttemptRef.current = 0;
        };

        ws.onmessage = (event) => {
          if (!mountedRef.current) return;
          let frame: Record<string, unknown>;
          try {
            frame = JSON.parse(event.data as string);
          } catch {
            return;
          }

          const channel = frame.channel as string | undefined;
          const frameType = frame.type as string | undefined;
          const payload = frame.payload as Record<string, unknown> | null;

          // --- Control Channel: Handshake & Presence ---
          if (channel === "control" || frameType === "control-response") {
            if (!gotAck && payload?.type === "connected") {
              gotAck = true;
              ws.send(
                JSON.stringify({
                  channel: "control",
                  roomId,
                  seq: ++seqRef.current,
                  payload: { type: "create-room" },
                })
              );
            } else if (
              gotAck &&
              (payload?.type === "create-room" ||
                payload?.type === "room-created" ||
                payload?.type === "join-room" ||
                payload?.type === "room-joined")
            ) {
              setConnectionStatus("connected");
            } else if (frameType === "presence-join" && payload?.clientId) {
              setParticipants((prev) =>
                prev.some((x) => x.clientId === payload.clientId)
                  ? prev
                  : [
                      ...prev,
                      {
                        clientId: payload.clientId as string,
                        displayName: (payload.displayName as string) || "Anon",
                        color: (payload.color as string) || "#888",
                      },
                    ]
              );
            } else if (frameType === "presence-leave" && payload?.clientId) {
              setParticipants((prev) =>
                prev.filter((x) => x.clientId !== payload.clientId)
              );
            }
            return;
          }

          // --- Ops Channel: Receive scene from other client ---
          if (channel === "ops" && frameType === "delta") {
            const deltaPayload = payload as {
              changes?: Array<{
                type: string;
                itemId: string;
                fields?: Record<string, unknown>;
              }>;
            } | null;
            const changes = deltaPayload?.changes;
            if (!changes || !excalidrawAPIRef.current) return;
            // Don't apply remote scenes while user is actively editing
            if (userActiveRef.current) return;

            for (const change of changes) {
              // Direct scene sync format
              if (
                change.itemId === "__scene__" &&
                change.fields?.scene
              ) {
                const remoteScene = change.fields.scene as ExcalidrawElement[];
                if (Array.isArray(remoteScene)) {
                  // MERGE: combine remote elements with local elements
                  const localElements = excalidrawAPIRef.current.getSceneElementsIncludingDeleted();
                  const merged = mergeScenes(localElements as ExcalidrawElement[], remoteScene);
                  suppressRef.current = true;
                  excalidrawAPIRef.current.updateScene({ elements: merged });
                  setTimeout(() => { suppressRef.current = false; }, 100);
                }
                return;
              }
              // LWW register wrapper (from snapshot restore)
              if (change.itemId === "__scene__") {
                const nestedFields = change.fields?.fields as
                  | Record<string, { value?: unknown }>
                  | undefined;
                if (nestedFields?.scene?.value) {
                  const remoteScene = nestedFields.scene.value as ExcalidrawElement[];
                  if (Array.isArray(remoteScene)) {
                    const localElements = excalidrawAPIRef.current.getSceneElementsIncludingDeleted();
                    const merged = mergeScenes(localElements as ExcalidrawElement[], remoteScene);
                    suppressRef.current = true;
                    excalidrawAPIRef.current.updateScene({ elements: merged });
                    setTimeout(() => { suppressRef.current = false; }, 100);
                  }
                  return;
                }
              }
            }
          }

          // --- Awareness Channel: Remote Cursors ---
          if (channel === "awareness" && frameType === "awareness-update") {
            if (!payload?.clientId) return;
            // Use displayName as the stable key (backend clientId changes on reconnect)
            const displayName = (payload.displayName as string) || "Anon";
            // Skip our own cursor (match by displayName since clientId is unreliable)
            if (displayName === identityRef.current.displayName) return;
            const cursor = payload.cursor as
              | { x: number; y: number }
              | undefined;
            if (cursor) {
              setCollaborators((prev) => {
                // Use displayName as key to prevent duplicates from reconnections
                const next = new Map(prev);
                next.set(displayName, {
                  username: displayName,
                  color: {
                    background: (payload.color as string) || "#888",
                    stroke: (payload.color as string) || "#888",
                  },
                  pointer: { x: cursor.x, y: cursor.y, tool: "pointer" },
                });
                return next;
              });
            }
          }
        };

        ws.onclose = () => {
          if (!mountedRef.current) return;
          wsRef.current = null;
          setConnectionStatus("reconnecting");
          setCollaborators(new Map()); // Clear stale cursors on disconnect
          const delay = computeBackoffDelay(reconnectAttemptRef.current++);
          reconnectTimerRef.current = setTimeout(connect, delay);
        };
      } catch {
        if (!mountedRef.current) return;
        setConnectionStatus("reconnecting");
        const delay = computeBackoffDelay(reconnectAttemptRef.current++);
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    }

    connect();

    // Prune stale cursors every 5s
    const pruneInterval = setInterval(() => {
      // Clear all collaborators — they'll be re-added by the next awareness update
      // This ensures stale cursors from disconnected users disappear
      setCollaborators(new Map());
    }, 5000);

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      if (userActiveTimerRef.current) clearTimeout(userActiveTimerRef.current);
      clearInterval(pruneInterval);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [roomId, sendRaw, enabled]);

  return {
    connectionStatus,
    collaborators,
    participants,
    handleLocalChange,
    sendAwareness,
  };
}
