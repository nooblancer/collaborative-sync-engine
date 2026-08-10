"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CRDTOperation,
  InventoryItem,
  ItemChange,
  ServerMessage,
  StateDelta,
} from "@/lib/types";
import { MAX_NAME_LENGTH, MAX_QUANTITY, MIN_QUANTITY } from "@/lib/constants";
import type { UseWebSocketReturn } from "@/hooks/use-websocket";

export interface UseInventoryReturn {
  items: InventoryItem[];
  addItem: (name: string, quantity: number) => void;
  updateQuantity: (itemId: string, delta: number) => void;
  removeItem: (itemId: string) => void;
  flashingItemId: string | null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function generateOperationId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

export function useInventory(
  ws: UseWebSocketReturn,
  currentUser: string
): UseInventoryReturn {
  const itemsMapRef = useRef<Map<string, InventoryItem>>(new Map());
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [flashingItemId, setFlashingItemId] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync items array from the map ref
  const syncItems = useCallback(() => {
    setItems(Array.from(itemsMapRef.current.values()));
  }, []);

  // --- addItem ---
  const addItem = useCallback(
    (name: string, quantity: number) => {
      // Validate name: must be trimmed non-empty and ≤100 chars
      const trimmedName = name.trim();
      if (trimmedName.length === 0 || trimmedName.length > MAX_NAME_LENGTH) {
        return;
      }

      // Validate quantity: must be an integer in [0, 10000]
      if (
        !Number.isInteger(quantity) ||
        quantity < MIN_QUANTITY ||
        quantity > MAX_QUANTITY
      ) {
        return;
      }

      // Generate itemId
      const itemId = `${slugify(trimmedName)}-${Date.now().toString(36)}`;

      // Create the new item
      const newItem: InventoryItem = {
        itemId,
        name: trimmedName,
        quantity,
        removedAt: null,
        lastUpdatedBy: currentUser,
      };

      // Optimistic local update
      itemsMapRef.current.set(itemId, newItem);
      syncItems();

      // Send operation
      const operation: CRDTOperation = {
        operationId: generateOperationId(),
        type: "add",
        itemId,
        payload: { name: trimmedName, quantity },
      };

      ws.sendMessage({ type: "operation", payload: operation });
    },
    [currentUser, ws, syncItems]
  );

  // --- updateQuantity ---
  const updateQuantity = useCallback(
    (itemId: string, delta: number) => {
      const item = itemsMapRef.current.get(itemId);
      if (!item || item.removedAt !== null) {
        return;
      }

      const newQuantity = clamp(item.quantity + delta, MIN_QUANTITY, MAX_QUANTITY);

      // Update local state optimistically
      const updatedItem: InventoryItem = {
        ...item,
        quantity: newQuantity,
        lastUpdatedBy: currentUser,
      };
      itemsMapRef.current.set(itemId, updatedItem);
      syncItems();

      // Send operation
      const operation: CRDTOperation = {
        operationId: generateOperationId(),
        type: "update",
        itemId,
        payload: { quantity: newQuantity },
      };

      ws.sendMessage({ type: "operation", payload: operation });
    },
    [currentUser, ws, syncItems]
  );

  // --- removeItem ---
  const removeItem = useCallback(
    (itemId: string) => {
      const item = itemsMapRef.current.get(itemId);
      if (!item || item.removedAt !== null) {
        return;
      }

      // Mark as removed locally
      const removedItem: InventoryItem = {
        ...item,
        removedAt: Date.now(),
        lastUpdatedBy: currentUser,
      };
      itemsMapRef.current.set(itemId, removedItem);
      syncItems();

      // Send operation
      const operation: CRDTOperation = {
        operationId: generateOperationId(),
        type: "remove",
        itemId,
      };

      ws.sendMessage({ type: "operation", payload: operation });
    },
    [currentUser, ws, syncItems]
  );

  // --- Delta handling ---
  useEffect(() => {
    const unsubscribe = ws.subscribe("delta", (msg: ServerMessage) => {
      if (msg.type !== "delta") return;

      const delta: StateDelta = msg.payload;
      let lastChangedItemId: string | null = null;

      for (const change of delta.changes) {
        lastChangedItemId = change.itemId;
        applyChange(change);
      }

      syncItems();

      // Flash the last changed item
      if (lastChangedItemId) {
        if (flashTimerRef.current) {
          clearTimeout(flashTimerRef.current);
        }
        setFlashingItemId(lastChangedItemId);
        flashTimerRef.current = setTimeout(() => {
          setFlashingItemId(null);
          flashTimerRef.current = null;
        }, 1000);
      }
    });

    return unsubscribe;
  }, [ws, syncItems]);

  // Apply a single ItemChange to the items map
  function applyChange(change: ItemChange): void {
    switch (change.type) {
      case "added": {
        const newItem: InventoryItem = {
          itemId: change.itemId,
          name: change.name ?? "",
          quantity: change.quantity ?? 0,
          removedAt: change.removedAt ?? null,
          lastUpdatedBy: change.lastUpdatedBy ?? "",
        };
        itemsMapRef.current.set(change.itemId, newItem);
        break;
      }
      case "updated": {
        const existing = itemsMapRef.current.get(change.itemId);
        if (existing) {
          const updated: InventoryItem = {
            ...existing,
            ...(change.name !== undefined && { name: change.name }),
            ...(change.quantity !== undefined && { quantity: change.quantity }),
            ...(change.lastUpdatedBy !== undefined && {
              lastUpdatedBy: change.lastUpdatedBy,
            }),
          };
          itemsMapRef.current.set(change.itemId, updated);
        }
        break;
      }
      case "removed": {
        const existing = itemsMapRef.current.get(change.itemId);
        if (existing) {
          const removed: InventoryItem = {
            ...existing,
            removedAt: change.removedAt ?? Date.now(),
            ...(change.lastUpdatedBy !== undefined && {
              lastUpdatedBy: change.lastUpdatedBy,
            }),
          };
          itemsMapRef.current.set(change.itemId, removed);
        }
        break;
      }
    }
  }

  // Clean up flash timer on unmount
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  return {
    items,
    addItem,
    updateQuantity,
    removeItem,
    flashingItemId,
  };
}
