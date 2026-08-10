import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ArchitectureSection from "../architecture-section";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
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

describe("ArchitectureSection", () => {
  it("renders the heading 'How It Works'", () => {
    render(<ArchitectureSection />);
    expect(screen.getByText("How It Works")).toBeInTheDocument();
  });

  it("renders five step card titles", () => {
    render(<ArchitectureSection />);
    expect(screen.getByText("Client")).toBeInTheDocument();
    expect(screen.getByText("WebSocket")).toBeInTheDocument();
    expect(screen.getByText("Sync Engine")).toBeInTheDocument();
    expect(screen.getByText("CRDT Merge")).toBeInTheDocument();
    expect(screen.getByText("Broadcast")).toBeInTheDocument();
  });

  it("renders descriptions for each step", () => {
    render(<ArchitectureSection />);
    expect(
      screen.getByText(/Operations are created locally with optimistic updates/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Changes propagate through persistent WebSocket connections/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The central engine validates and orders operations/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Conflict-free merge using Last-Writer-Wins registers/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Minimal state deltas are broadcast to all connected clients/)
    ).toBeInTheDocument();
  });
});
