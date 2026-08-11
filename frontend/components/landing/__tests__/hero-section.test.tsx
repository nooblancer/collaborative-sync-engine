import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import HeroSection from "../hero-section";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div data-testid="motion-div" {...props}>{children}</div>,
    h1: ({ children, ...props }: any) => <h1 {...props}>{children}</h1>,
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
  },
  useInView: () => true,
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock the sync engine hook to avoid actual WebSocket connections in tests
vi.mock("@/hooks/use-sync-engine", () => ({
  useSyncEngine: () => ({
    connectionState: "disconnected",
    metrics: null,
    sendOperation: vi.fn(),
    sendControl: vi.fn(),
    subscribe: () => () => {},
  }),
}));

describe("HeroSection", () => {
  it("renders the headline with performance claim", () => {
    render(<HeroSection />);
    expect(screen.getByText("Real-Time Sync")).toBeInTheDocument();
    expect(screen.getByText("at 50,000 ops/sec")).toBeInTheDocument();
  });

  it("renders the description paragraph", () => {
    render(<HeroSection />);
    expect(
      screen.getByText(/Production-grade CRDT collaboration engine/)
    ).toBeInTheDocument();
  });

  it("renders CTA buttons", () => {
    render(<HeroSection />);
    expect(screen.getByText("Launch Stress Test")).toBeInTheDocument();
    expect(screen.getByText("View Architecture")).toBeInTheDocument();
  });

  it("renders the version badge", () => {
    render(<HeroSection />);
    expect(screen.getByText(/Engine v2.0/)).toBeInTheDocument();
  });

  it("renders the live visualization canvas", () => {
    render(<HeroSection />);
    expect(
      screen.getByLabelText("Live operation processing visualization")
    ).toBeInTheDocument();
  });

  it("renders metric counters for throughput, latency, and total ops", () => {
    render(<HeroSection />);
    expect(screen.getByText("Throughput")).toBeInTheDocument();
    expect(screen.getByText("P50 Latency")).toBeInTheDocument();
    expect(screen.getByText("Total Ops")).toBeInTheDocument();
  });

  it("displays connection indicator", () => {
    render(<HeroSection />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows the sync engine room identifier", () => {
    render(<HeroSection />);
    expect(screen.getByText("sync-engine://hero-demo")).toBeInTheDocument();
  });
});
