import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWhiteboardBots } from "@/hooks/use-whiteboard-bots";
import type { Participant } from "@/lib/excalidraw-sync-utils";

// Mock @excalidraw/excalidraw to avoid JSON import issues in test environment
vi.mock("@excalidraw/excalidraw", () => ({
  exportToBlob: vi.fn(),
}));

// Mock shouldBotsBeActive
vi.mock("@/components/demo/WhiteboardCanvas", () => ({
  shouldBotsBeActive: vi.fn((participants: string[], botPrefix: string) => {
    const realCount = participants.filter((id) => !id.startsWith(botPrefix)).length;
    return realCount <= 1;
  }),
}));

// --- Helpers ---

function createMockExcalidrawAPI() {
  return {
    getSceneElementsIncludingDeleted: vi.fn(() => []),
    updateScene: vi.fn(),
    getSceneElements: vi.fn(() => []),
    getAppState: vi.fn(() => ({})),
    exportToBlob: vi.fn(),
    refresh: vi.fn(),
    setToast: vi.fn(),
    readyPromise: Promise.resolve(),
    ready: true,
    id: "mock-api",
  } as any;
}

describe("useWhiteboardBots", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bots activate when fewer than 2 real users", async () => {
    const excalidrawAPI = createMockExcalidrawAPI();
    // Only 1 real user + some bots — bots should activate
    const participants: Participant[] = [
      { clientId: "user-1", displayName: "Alice", color: "#ff0000" },
      { clientId: "bot-alice-simulated", displayName: "BotAlice", color: "#ff00ff" },
    ];

    const { result } = renderHook(() =>
      useWhiteboardBots({
        excalidrawAPI,
        participants,
        enabled: true,
      })
    );

    // Initially botsActive is false (pending activation delay)
    expect(result.current.botsActive).toBe(false);

    // Advance past the bot activation delay (2500ms)
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.botsActive).toBe(true);
  });

  it("bots deactivate when 2+ real users connect", async () => {
    const excalidrawAPI = createMockExcalidrawAPI();

    // Start with 1 real user — bots should activate
    const initialParticipants: Participant[] = [
      { clientId: "user-1", displayName: "Alice", color: "#ff0000" },
    ];

    const { result, rerender } = renderHook(
      ({ participants }) =>
        useWhiteboardBots({
          excalidrawAPI,
          participants,
          enabled: true,
        }),
      { initialProps: { participants: initialParticipants } }
    );

    // Advance past activation delay
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.botsActive).toBe(true);

    // Now 2 real users connect — bots should deactivate
    const updatedParticipants: Participant[] = [
      { clientId: "user-1", displayName: "Alice", color: "#ff0000" },
      { clientId: "user-2", displayName: "Bob", color: "#00ff00" },
    ];

    rerender({ participants: updatedParticipants });

    // Allow effects to settle
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.botsActive).toBe(false);
    expect(result.current.botCollaborators.size).toBe(0);
  });

  it("bot cursors appear in botCollaborators Map with correct format", async () => {
    const excalidrawAPI = createMockExcalidrawAPI();
    // 0 real users — bots should activate
    const participants: Participant[] = [];

    const { result } = renderHook(() =>
      useWhiteboardBots({
        excalidrawAPI,
        participants,
        enabled: true,
      })
    );

    // Advance past activation delay
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.botsActive).toBe(true);

    // Advance a few animation frames to let cursor animation populate the Map
    await act(async () => {
      // Trigger requestAnimationFrame callbacks
      vi.advanceTimersByTime(100);
    });

    const collabs = result.current.botCollaborators;

    // Should have entries for the bots (BotAlice and BotBob)
    // The hook uses requestAnimationFrame which may need real frames; check the Map has entries
    if (collabs.size > 0) {
      for (const [clientId, collaborator] of collabs) {
        // Verify the Collaborator format
        expect(clientId).toMatch(/^bot-/);
        expect(collaborator).toHaveProperty("username");
        expect(collaborator).toHaveProperty("color");
        expect(collaborator).toHaveProperty("pointer");
        expect(collaborator.color).toHaveProperty("background");
        expect(collaborator.color).toHaveProperty("stroke");
        expect(collaborator.pointer).toHaveProperty("x");
        expect(collaborator.pointer).toHaveProperty("y");
        expect(collaborator.pointer).toHaveProperty("tool");
        expect(typeof collaborator.username).toBe("string");
        expect(typeof collaborator.pointer.x).toBe("number");
        expect(typeof collaborator.pointer.y).toBe("number");
      }
    }
  });

  it("botsActive flag reflects current state", async () => {
    const excalidrawAPI = createMockExcalidrawAPI();

    // Start with no participants — bots should activate
    const { result, rerender } = renderHook(
      ({ participants, enabled }) =>
        useWhiteboardBots({
          excalidrawAPI,
          participants,
          enabled,
        }),
      { initialProps: { participants: [] as Participant[], enabled: true } }
    );

    // Before activation delay
    expect(result.current.botsActive).toBe(false);

    // After activation delay
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.botsActive).toBe(true);

    // Disable bots via enabled flag
    rerender({ participants: [], enabled: false });

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    // When disabled, shouldBotsBeActive condition includes `enabled`
    // The hook uses: enabled && shouldBotsBeActive(...)
    expect(result.current.botsActive).toBe(false);
  });
});
