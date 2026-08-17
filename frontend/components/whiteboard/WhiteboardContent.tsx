"use client";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Trash2 } from "lucide-react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useExcalidrawSync } from "@/hooks/use-excalidraw-sync";
import { ConnectionIndicator } from "@/components/ui/connection-indicator";
import PresenceBar from "@/components/whiteboard/PresenceBar";

// Excalidraw requires its CSS for proper rendering
import "@excalidraw/excalidraw/index.css";

const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((mod) => mod.Excalidraw),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center text-white/40 text-sm">
        Loading canvas…
      </div>
    ),
  }
);

export default function WhiteboardContent(): JSX.Element {
  const searchParams = useSearchParams();
  const roomParam = searchParams.get("room");

  const [roomId, setRoomId] = useState<string | null>(roomParam);
  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);

  const isCollaborative = !!roomId;

  const {
    connectionStatus,
    collaborators,
    participants,
    handleLocalChange,
    sendAwareness,
  } = useExcalidrawSync({
    roomId: roomId || "",
    excalidrawAPI,
    enabled: isCollaborative,
  });

  // Update collaborators on the Excalidraw instance
  useEffect(() => {
    if (excalidrawAPI) {
      excalidrawAPI.updateScene({
        collaborators: collaborators as unknown as Map<
          string & { _brand: "SocketId" },
          Record<string, unknown>
        >,
      });
    }
  }, [excalidrawAPI, collaborators]);

  // Derive connected user count from collaborators (real-time from awareness)
  // +1 for self
  const connectedCount = collaborators.size + (isCollaborative ? 1 : 0);

  // Expose startCollaboration globally so navbar Share button can trigger it
  useEffect(() => {
    (window as any).__whiteboardStartCollab = () => {
      if (!isCollaborative) {
        const id = Math.random().toString(36).slice(2, 8);
        setRoomId(id);
        const url = new URL(window.location.href);
        url.searchParams.set("room", id);
        window.history.replaceState({}, "", url.toString());
      }
    };
    return () => { delete (window as any).__whiteboardStartCollab; };
  }, [isCollaborative]);

  // Clear the entire board
  const handleClearBoard = useCallback(() => {
    if (!excalidrawAPI) return;
    excalidrawAPI.updateScene({ elements: [] });
    excalidrawAPI.history.clear();
  }, [excalidrawAPI]);

  return (
    <div className="h-full w-full flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-[#0a0a1a] border-b border-white/5">
        <div className="flex items-center gap-2">
          {isCollaborative && (
            <PresenceBar
              participants={[
                // Include self
                { clientId: "self", displayName: "You", color: "#00d4ff" },
                // Include remote users derived from collaborators (real-time)
                ...Array.from(collaborators.entries()).map(([key, collab]) => ({
                  clientId: key,
                  displayName: collab.username,
                  color: collab.color.background,
                })),
              ]}
              botsActive={false}
            />
          )}

          {/* Clear board */}
          <button
            onClick={handleClearBoard}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium bg-black/40 text-white/60 border border-white/10 hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/40 transition-all"
            title="Clear board"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>

        <div className="flex items-center gap-2">
          {isCollaborative && (
            <>
              <span className="text-[10px] font-mono text-white/30 bg-black/30 px-2 py-1 rounded">
                {roomId}
              </span>
              <ConnectionIndicator status={connectionStatus} size="sm" />
            </>
          )}
          {!isCollaborative && (
            <span className="text-[10px] text-white/30">
              Click Share to start collaborating
            </span>
          )}
        </div>
      </div>

      {/* Excalidraw fills the remaining space */}
      <div className="flex-1 min-h-0">
        <Excalidraw
          excalidrawAPI={(api: ExcalidrawImperativeAPI) => setExcalidrawAPI(api)}
          theme="dark"
          onChange={(elements) => handleLocalChange(elements)}
          onPointerUpdate={(payload) => sendAwareness(payload)}
          initialData={{
            elements: [],
            appState: {
              theme: "dark",
              viewBackgroundColor: "#0a0a1a",
            },
          }}
          UIOptions={{
            canvasActions: {
              export: { saveFileToDisk: true },
              clearCanvas: true,
            },
          }}
        />
      </div>
    </div>
  );
}
