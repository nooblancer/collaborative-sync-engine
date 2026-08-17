import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Participant, Collaborator } from "@/lib/excalidraw-sync-utils";

// --- Mocks ---

// Mock @excalidraw/excalidraw — render a simple div that accepts children
vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="excalidraw-canvas">{children}</div>
  ),
  exportToBlob: vi.fn(),
}));

// Mock next/dynamic to render children directly (bypass SSR-only dynamic import)
vi.mock("next/dynamic", () => ({
  __esModule: true,
  default: (loader: () => Promise<any>, _opts?: any) => {
    // Return a component that renders the loaded module synchronously for tests
    const LazyComponent = (props: any) => {
      // For Excalidraw dynamic import, render the mock
      const MockExcalidraw = ({ children, ...rest }: any) => (
        <div data-testid="excalidraw-canvas" {...rest}>{children}</div>
      );
      return <MockExcalidraw {...props} />;
    };
    LazyComponent.displayName = "DynamicMock";
    return LazyComponent;
  },
}));

// Mock hooks
const mockCopyShareUrl = vi.fn().mockResolvedValue(true);
vi.mock("@/hooks/use-room-id", () => ({
  useRoomId: () => ({
    roomId: "whiteboard-abc123",
    getShareUrl: () => "http://localhost:3000/whiteboard?room=whiteboard-abc123",
    copyShareUrl: mockCopyShareUrl,
  }),
}));

const mockHandleLocalChange = vi.fn();
const mockSendAwareness = vi.fn();
let mockConnectionStatus: "connected" | "disconnected" | "reconnecting" = "connected";
let mockParticipants: Participant[] = [];
let mockCollaborators = new Map<string, Collaborator>();

vi.mock("@/hooks/use-excalidraw-sync", () => ({
  useExcalidrawSync: () => ({
    connectionStatus: mockConnectionStatus,
    collaborators: mockCollaborators,
    participants: mockParticipants,
    handleLocalChange: mockHandleLocalChange,
    sendAwareness: mockSendAwareness,
  }),
}));

vi.mock("@/hooks/use-whiteboard-bots", () => ({
  useWhiteboardBots: () => ({
    botCollaborators: new Map(),
    botsActive: false,
  }),
}));

// Mock lucide-react icons to simple spans for test simplicity
vi.mock("lucide-react", () => ({
  Share2: (props: any) => <span data-testid="share-icon" {...props} />,
  Check: (props: any) => <span data-testid="check-icon" {...props} />,
  Download: (props: any) => <span data-testid="download-icon" {...props} />,
  Wifi: (props: any) => <span data-testid="wifi-icon" {...props} />,
  WifiOff: (props: any) => <span data-testid="wifi-off-icon" {...props} />,
  RefreshCw: (props: any) => <span data-testid="refresh-icon" {...props} />,
}));

// Mock next/navigation for useSearchParams
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

// Import components AFTER mocks are set up
import WhiteboardContent from "@/components/whiteboard/WhiteboardContent";
import PresenceBar from "@/components/whiteboard/PresenceBar";

// --- Tests ---

describe("WhiteboardContent (Req 1.1, 1.3, 2.3, 2.4, 2.6, 6.4, 8.1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockConnectionStatus = "connected";
    mockParticipants = [];
    mockCollaborators = new Map();
    mockCopyShareUrl.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders room ID in header (Req 2.6)", () => {
    render(<WhiteboardContent />);
    expect(screen.getByText("whiteboard-abc123")).toBeInTheDocument();
  });

  it("renders Share button that copies URL and shows 'Copied!' for 2s (Req 2.3, 2.4)", async () => {
    // Use real timers for this test since it involves async Promise resolution + setTimeout
    vi.useRealTimers();

    render(<WhiteboardContent />);

    // Find and click Share button
    const shareBtn = screen.getByRole("button", { name: /share/i });
    expect(shareBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(shareBtn);
      // Allow the async copyShareUrl to resolve
      await mockCopyShareUrl();
    });

    // copyShareUrl should have been called
    expect(mockCopyShareUrl).toHaveBeenCalled();

    // After successful copy, button text should change to "Copied!"
    await waitFor(() => {
      expect(screen.getByText("Copied!")).toBeInTheDocument();
    });

    // After 2 seconds, should revert to "Share"
    await waitFor(
      () => {
        expect(screen.getByText("Share")).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    // Restore fake timers for other tests
    vi.useFakeTimers();
  });

  it("Share button does not show 'Copied!' when copy fails (Req 2.5)", async () => {
    mockCopyShareUrl.mockResolvedValue(false);
    render(<WhiteboardContent />);

    const shareBtn = screen.getByRole("button", { name: /share/i });

    await act(async () => {
      fireEvent.click(shareBtn);
    });

    // Should NOT show "Copied!" — remains "Share"
    expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
    expect(screen.getByText("Share")).toBeInTheDocument();
  });

  it("renders Export button (Req 8.1)", () => {
    render(<WhiteboardContent />);
    const exportBtn = screen.getByRole("button", { name: /export/i });
    expect(exportBtn).toBeInTheDocument();
  });

  it("renders ConnectionIndicator showing correct status (Req 6.4)", () => {
    mockConnectionStatus = "connected";
    const { rerender } = render(<WhiteboardContent />);

    // ConnectionIndicator uses role="status"
    const indicators = screen.getAllByRole("status");
    expect(indicators.length).toBeGreaterThan(0);
    // At least one should have "connected" in its aria-label
    const connectedIndicator = indicators.find(
      (el) => el.getAttribute("aria-label")?.toLowerCase().includes("connected")
    );
    expect(connectedIndicator).toBeTruthy();
  });

  it("renders ConnectionIndicator with reconnecting status", () => {
    mockConnectionStatus = "reconnecting";
    render(<WhiteboardContent />);

    const indicators = screen.getAllByRole("status");
    const reconnectingIndicator = indicators.find(
      (el) => el.getAttribute("aria-label")?.toLowerCase().includes("reconnecting")
    );
    expect(reconnectingIndicator).toBeTruthy();
  });
});

describe("PresenceBar (Req 6.1)", () => {
  it("renders all participants with names and colors", () => {
    const participants: Participant[] = [
      { clientId: "user-1", displayName: "Alice", color: "#ff6b6b" },
      { clientId: "user-2", displayName: "Bob", color: "#48dbfb" },
      { clientId: "user-3", displayName: "Charlie", color: "#feca57" },
    ];

    render(<PresenceBar participants={participants} botsActive={false} />);

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  it("renders color dots for each participant", () => {
    const participants: Participant[] = [
      { clientId: "user-1", displayName: "Alice", color: "#ff6b6b" },
      { clientId: "user-2", displayName: "Bob", color: "#48dbfb" },
    ];

    const { container } = render(
      <PresenceBar participants={participants} botsActive={false} />
    );

    // Color dots are w-3 h-3 rounded-full elements with inline backgroundColor
    const dots = container.querySelectorAll(".w-3.h-3.rounded-full");
    expect(dots.length).toBe(2);
    expect((dots[0] as HTMLElement).style.backgroundColor).toBe("rgb(255, 107, 107)");
    expect((dots[1] as HTMLElement).style.backgroundColor).toBe("rgb(72, 219, 251)");
  });

  it("shows bots active indicator when botsActive is true", () => {
    render(<PresenceBar participants={[]} botsActive={true} />);
    expect(screen.getByText(/Bots active/)).toBeInTheDocument();
  });

  it("renders nothing when no participants and bots inactive", () => {
    const { container } = render(
      <PresenceBar participants={[]} botsActive={false} />
    );
    // Should render an empty fragment
    expect(container.innerHTML).toBe("");
  });
});
