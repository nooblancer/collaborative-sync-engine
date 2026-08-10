"use client";

import { useCallback, useEffect, useState } from "react";
import { useWebSocket } from "@/hooks/use-websocket";
import { usePresence } from "@/hooks/use-presence";
import { useInventory } from "@/hooks/use-inventory";
import { ConnectionStatus } from "@/components/demo/connection-status";
import { PresenceBar } from "@/components/demo/presence-bar";
import { AddItemForm } from "@/components/demo/add-item-form";
import { InventoryTable } from "@/components/demo/inventory-table";
import { EventLog } from "@/components/demo/event-log";
import type { EventLogEntry } from "@/components/demo/event-log";
import { BACKEND_URL, MAX_EVENT_LOG_ENTRIES } from "@/lib/constants";
import type { ServerMessage } from "@/lib/types";

function createEntry(
  message: string,
  type: EventLogEntry["type"]
): EventLogEntry {
  return { id: crypto.randomUUID(), timestamp: new Date(), message, type };
}

export default function DemoPage() {
  const ws = useWebSocket(BACKEND_URL);
  const { users, currentUser } = usePresence(ws);
  const { items, addItem, updateQuantity, removeItem, flashingItemId } =
    useInventory(ws, currentUser.displayName);

  const [eventEntries, setEventEntries] = useState<EventLogEntry[]>([]);

  const prependEntry = useCallback(
    (message: string, type: EventLogEntry["type"]) => {
      setEventEntries((prev) =>
        [createEntry(message, type), ...prev].slice(0, MAX_EVENT_LOG_ENTRIES)
      );
    },
    []
  );

  // Subscribe to ack messages
  useEffect(() => {
    const unsub = ws.subscribe("ack", (msg: ServerMessage) => {
      if (msg.type === "ack") {
        prependEntry(
          `Operation acknowledged: ${msg.operationId}`,
          "info"
        );
      }
    });
    return unsub;
  }, [ws, prependEntry]);

  // Subscribe to delta messages
  useEffect(() => {
    const unsub = ws.subscribe("delta", (msg: ServerMessage) => {
      if (msg.type === "delta") {
        prependEntry(
          `Received delta: ${msg.payload.changes.length} change(s)`,
          "info"
        );
      }
    });
    return unsub;
  }, [ws, prependEntry]);

  // Subscribe to error messages
  useEffect(() => {
    const unsub = ws.subscribe("error", (msg: ServerMessage) => {
      if (msg.type === "error") {
        prependEntry(`Error: ${msg.message}`, "error");
      }
    });
    return unsub;
  }, [ws, prependEntry]);

  // Subscribe to presence-join messages
  useEffect(() => {
    const unsub = ws.subscribe("presence-join", (msg: ServerMessage) => {
      if (msg.type === "presence-join") {
        prependEntry(`${msg.user.displayName} joined`, "info");
      }
    });
    return unsub;
  }, [ws, prependEntry]);

  // Subscribe to presence-leave messages
  useEffect(() => {
    const unsub = ws.subscribe("presence-leave", (msg: ServerMessage) => {
      if (msg.type === "presence-leave") {
        prependEntry(`User left: ${msg.userId}`, "general");
      }
    });
    return unsub;
  }, [ws, prependEntry]);

  // Wrapper handlers to log user actions
  const handleAddItem = useCallback(
    (name: string, quantity: number) => {
      addItem(name, quantity);
      prependEntry(`Added item: ${name} (qty: ${quantity})`, "general");
    },
    [addItem, prependEntry]
  );

  const handleIncrement = useCallback(
    (itemId: string) => {
      updateQuantity(itemId, 1);
      prependEntry(`Incremented: ${itemId}`, "general");
    },
    [updateQuantity, prependEntry]
  );

  const handleDecrement = useCallback(
    (itemId: string) => {
      updateQuantity(itemId, -1);
      prependEntry(`Decremented: ${itemId}`, "general");
    },
    [updateQuantity, prependEntry]
  );

  const handleRemove = useCallback(
    (itemId: string) => {
      removeItem(itemId);
      prependEntry(`Removed item: ${itemId}`, "general");
    },
    [removeItem, prependEntry]
  );

  const isDisconnected = ws.status !== "connected";

  return (
    <main className="min-h-screen p-4 md:p-8">
      {/* Header area: Connection Status + Presence Bar */}
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <ConnectionStatus status={ws.status} />
        <PresenceBar users={users} currentUserId={currentUser.userId} />
      </header>

      {/* Main area: Two-column layout on desktop */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left column: AddItemForm + InventoryTable */}
        <section className="flex flex-col gap-4">
          <AddItemForm onSubmit={handleAddItem} disabled={isDisconnected} />
          <InventoryTable
            items={items}
            flashingItemId={flashingItemId}
            onIncrement={handleIncrement}
            onDecrement={handleDecrement}
            onRemove={handleRemove}
            disabled={isDisconnected}
          />
        </section>

        {/* Right column: EventLog */}
        <section>
          <h2 className="mb-2 text-lg font-semibold">Event Log</h2>
          <EventLog entries={eventEntries} maxEntries={MAX_EVENT_LOG_ENTRIES} />
        </section>
      </div>
    </main>
  );
}
