import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { exportToBlob } from "@excalidraw/excalidraw";

// --- Interfaces ---

export interface ElementOperation {
  type: "add" | "update" | "remove";
  itemId: string;
  payload: { element: ExcalidrawElement } | Record<string, never>;
}

export interface Collaborator {
  username: string;
  color: { background: string; stroke: string };
  pointer: { x: number; y: number; tool: "laser" | "pointer" };
  isCurrentUser?: boolean;
}

export interface Participant {
  clientId: string;
  displayName: string;
  color: string;
}

export interface AwarenessOut {
  pointer: { x: number; y: number };
  button: string;
  displayName: string;
  color: string;
}

export interface AwarenessIn {
  clientId: string;
  displayName: string;
  color: string;
  pointer: { x: number; y: number };
  lastUpdate: number;
}

// --- Utility Functions ---

/**
 * Compares two element arrays and returns the operations needed to sync them.
 * Detects additions, updates (version/nonce change), and removals (isDeleted transition).
 */
export function diffElements(
  prev: readonly ExcalidrawElement[],
  current: readonly ExcalidrawElement[]
): ElementOperation[] {
  const prevMap = new Map(prev.map((el) => [el.id, el]));
  const ops: ElementOperation[] = [];

  for (const el of current) {
    const prevEl = prevMap.get(el.id);
    if (!prevEl) {
      ops.push({ type: "add", itemId: el.id, payload: { element: el } });
    } else if (
      el.version > prevEl.version ||
      el.versionNonce !== prevEl.versionNonce
    ) {
      if (el.isDeleted && !prevEl.isDeleted) {
        ops.push({ type: "remove", itemId: el.id, payload: {} });
      } else {
        ops.push({ type: "update", itemId: el.id, payload: { element: el } });
      }
    }
  }
  return ops;
}

/**
 * Exports the current whiteboard scene as a PNG download.
 */
export async function exportWhiteboard(
  excalidrawAPI: ExcalidrawImperativeAPI,
  roomId: string
): Promise<void> {
  const elements = excalidrawAPI
    .getSceneElementsIncludingDeleted()
    .filter((el) => !el.isDeleted);
  const blob = await exportToBlob({
    elements,
    files: null,
    mimeType: "image/png",
    quality: 1,
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `whiteboard-${roomId}-${Date.now()}.png`;
  a.click();
  URL.revokeObjectURL(url);
}
