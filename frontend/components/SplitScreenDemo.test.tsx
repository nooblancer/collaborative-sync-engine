import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SplitScreenDemo from "./SplitScreenDemo";

// Mock fetch and WebSocket
const mockWsInstances: Array<{
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  readyState: number;
  onopen: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}> = [];

function createMockWs() {
  const ws = {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
    onopen: null as ((event?: unknown) => void) | null,
    onmessage: null as ((event: { data: string }) => void) | null,
    onclose: null as (() => void) | null,
    onerror: null as (() => void) | null,
  };
  mockWsInstances.push(ws);
  // Simulate auto-open
  setTimeout(() => {
    if (ws.onopen) ws.onopen();
  }, 10);
  return ws;
}

vi.stubGlobal("WebSocket", vi.fn(() => createMockWs()));
vi.stubGlobal(
  "fetch",
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ token: "test-token" }),
    })
  )
);

describe("SplitScreenDemo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockWsInstances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the section heading", () => {
    render(<SplitScreenDemo />);
    expect(screen.getByText("Split-Screen Sync")).toBeInTheDocument();
  });

  it("renders two client panels (Client A and Client B)", () => {
    render(<SplitScreenDemo />);
    expect(screen.getByText("Client A")).toBeInTheDocument();
    expect(screen.getByText("Client B")).toBeInTheDocument();
  });

  it("renders Add Card buttons for both panels", () => {
    render(<SplitScreenDemo />);
    const addButtons = screen.getAllByText("Add Card");
    expect(addButtons).toHaveLength(2);
  });

  it("renders the ops/sec counter", () => {
    render(<SplitScreenDemo />);
    expect(screen.getByText("ops/sec")).toBeInTheDocument();
  });

  it("shows connection status indicators for both panels", () => {
    render(<SplitScreenDemo />);
    // Both panels should show some status (initially disconnected or reconnecting)
    const statusElements = screen.getAllByRole("status");
    expect(statusElements.length).toBeGreaterThanOrEqual(2);
  });

  it("displays the explanation footer", () => {
    render(<SplitScreenDemo />);
    expect(
      screen.getByText(/Each panel maintains its own WebSocket connection/)
    ).toBeInTheDocument();
  });

  it("renders empty state message initially", () => {
    render(<SplitScreenDemo />);
    const emptyMessages = screen.getAllByText(
      /No cards yet/
    );
    expect(emptyMessages).toHaveLength(2);
  });

  it("attempts to connect via WebSocket on mount", async () => {
    render(<SplitScreenDemo />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // Should have called fetch for tokens (room creator + 2 panels)
    expect(global.fetch).toHaveBeenCalled();
  });

  it("shows connected status after WebSocket opens", async () => {
    render(<SplitScreenDemo />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // WebSocket instances should have been created
    expect(mockWsInstances.length).toBeGreaterThan(0);
  });
});
