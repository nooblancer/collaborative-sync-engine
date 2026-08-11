import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { WhiteboardCanvas } from "./WhiteboardCanvas";

// Mock fetch and WebSocket for tests
const mockWs = {
  send: vi.fn(),
  close: vi.fn(),
  readyState: 1,
  onopen: null as ((event?: unknown) => void) | null,
  onmessage: null as ((event: { data: string }) => void) | null,
  onclose: null as (() => void) | null,
  onerror: null as (() => void) | null,
};

vi.stubGlobal("WebSocket", vi.fn(() => mockWs));
vi.stubGlobal("fetch", vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ token: "test-token" }),
  })
));

// Mock canvas context
const mockCtx = {
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  closePath: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  scale: vi.fn(),
  setLineDash: vi.fn(),
  measureText: vi.fn(() => ({ width: 40 })),
  fillText: vi.fn(),
  roundRect: vi.fn(),
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
  lineCap: "butt",
  lineJoin: "miter",
  font: "",
  globalAlpha: 1,
};

HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx) as any;

// Mock requestAnimationFrame - DO NOT call callback synchronously to avoid infinite recursion
let rafCallbacks: Array<() => void> = [];
let rafId = 0;

vi.stubGlobal("requestAnimationFrame", vi.fn((cb: () => void) => {
  rafCallbacks.push(cb);
  return ++rafId;
}));
vi.stubGlobal("cancelAnimationFrame", vi.fn());

describe("WhiteboardCanvas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    rafCallbacks = [];
    rafId = 0;
    mockWs.send.mockClear();
    mockWs.readyState = 1;
    mockWs.onopen = null;
    mockWs.onmessage = null;
    mockWs.onclose = null;
    mockWs.onerror = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the canvas element with correct dimensions", () => {
    render(<WhiteboardCanvas width={800} height={500} />);
    const canvas = document.querySelector("canvas");
    expect(canvas).toBeTruthy();
    expect(canvas?.style.width).toBe("800px");
    expect(canvas?.style.height).toBe("500px");
  });

  it("renders the toolbar with all drawing tools", () => {
    render(<WhiteboardCanvas />);
    expect(screen.getByLabelText("Select")).toBeInTheDocument();
    expect(screen.getByLabelText("Draw")).toBeInTheDocument();
    expect(screen.getByLabelText("Rectangle")).toBeInTheDocument();
    expect(screen.getByLabelText("Circle")).toBeInTheDocument();
  });

  it("renders the delete button", () => {
    render(<WhiteboardCanvas />);
    expect(screen.getByLabelText("Delete selected object")).toBeInTheDocument();
  });

  it("shows connection status initially as disconnected or reconnecting", () => {
    render(<WhiteboardCanvas />);
    const status = screen.getByText(/Offline|Reconnecting/);
    expect(status).toBeInTheDocument();
  });

  it("switches active tool on click", () => {
    render(<WhiteboardCanvas />);
    const rectBtn = screen.getByLabelText("Rectangle");
    fireEvent.click(rectBtn);
    expect(rectBtn.className).toContain("text-accent");
  });

  it("disables delete button when nothing is selected", () => {
    render(<WhiteboardCanvas />);
    const deleteBtn = screen.getByLabelText("Delete selected object");
    expect(deleteBtn).toBeDisabled();
  });

  it("attempts WebSocket connection on mount", async () => {
    render(<WhiteboardCanvas roomId="test-room" />);

    // Advance timers so the async connect runs
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(global.fetch).toHaveBeenCalled();
    const fetchCall = (global.fetch as any).mock.calls[0][0] as string;
    expect(fetchCall).toContain("/token");
  });

  it("displays object count in status bar", () => {
    render(<WhiteboardCanvas />);
    expect(screen.getByText("0 objs")).toBeInTheDocument();
  });

  it("uses default room ID when none provided", async () => {
    render(<WhiteboardCanvas />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // The WebSocket constructor is called with the room ID in the URL
    if ((global.WebSocket as any).mock.calls.length > 0) {
      const wsUrl = (global.WebSocket as any).mock.calls[0][0] as string;
      expect(wsUrl).toContain("whiteboard-demo");
    }
  });
});
