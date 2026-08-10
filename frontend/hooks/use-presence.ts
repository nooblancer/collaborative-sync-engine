"use client";

import { useEffect, useState } from "react";
import type { UserPresence, ServerMessage } from "@/lib/types";
import { PRESENCE_REFRESH_INTERVAL_MS } from "@/lib/constants";
import type { UseWebSocketReturn } from "@/hooks/use-websocket";

export interface UsePresenceReturn {
  users: UserPresence[];
  currentUser: { userId: string; displayName: string };
}

const SESSION_IDENTITY_KEY = "sync-engine-user-identity";

function getSessionIdentity(): { userId: string; displayName: string } {
  if (typeof window !== "undefined") {
    const stored = sessionStorage.getItem(SESSION_IDENTITY_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Fall through to default
      }
    }
  }
  return { userId: "unknown", displayName: "Unknown" };
}

export function usePresence(ws: UseWebSocketReturn): UsePresenceReturn {
  const [users, setUsers] = useState<UserPresence[]>([]);
  const [currentUser] = useState<{ userId: string; displayName: string }>(
    getSessionIdentity
  );

  // Subscribe to presence messages
  useEffect(() => {
    const unsubList = ws.subscribe("presence-list", (msg: ServerMessage) => {
      if (msg.type === "presence-list") {
        setUsers(msg.users);
      }
    });

    const unsubJoin = ws.subscribe("presence-join", (msg: ServerMessage) => {
      if (msg.type === "presence-join") {
        setUsers((prev) => {
          const existing = prev.findIndex(
            (u) => u.userId === msg.user.userId
          );
          if (existing !== -1) {
            // Update existing entry rather than adding duplicate
            const updated = [...prev];
            updated[existing] = msg.user;
            return updated;
          }
          return [...prev, msg.user];
        });
      }
    });

    const unsubLeave = ws.subscribe("presence-leave", (msg: ServerMessage) => {
      if (msg.type === "presence-leave") {
        setUsers((prev) => prev.filter((u) => u.userId !== msg.userId));
      }
    });

    return () => {
      unsubList();
      unsubJoin();
      unsubLeave();
    };
  }, [ws]);

  // Send presence-request when connected and set up refresh interval
  useEffect(() => {
    if (ws.status !== "connected") {
      return;
    }

    // Send initial presence-request on connect
    ws.sendMessage({ type: "presence-request" });

    // Set up refresh interval
    const intervalId = setInterval(() => {
      ws.sendMessage({ type: "presence-request" });
    }, PRESENCE_REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [ws.status, ws.sendMessage]);

  return { users, currentUser };
}
