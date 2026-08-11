import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ArchitectureSection from "../architecture-section";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    h1: ({ children, ...props }: any) => <h1 {...props}>{children}</h1>,
    h2: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
    g: ({ children, ...props }: any) => <g {...props}>{children}</g>,
    path: (props: any) => <path {...props} />,
    text: ({ children, ...props }: any) => <text {...props}>{children}</text>,
  },
  useInView: () => true,
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock("lucide-react", () => ({
  Smartphone: ({ className }: any) => <svg data-testid="icon-smartphone" className={className} />,
  Radio: ({ className }: any) => <svg data-testid="icon-radio" className={className} />,
  Cpu: ({ className }: any) => <svg data-testid="icon-cpu" className={className} />,
  Database: ({ className }: any) => <svg data-testid="icon-database" className={className} />,
  Server: ({ className }: any) => <svg data-testid="icon-server" className={className} />,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
}));

describe("ArchitectureSection", () => {
  it("renders the heading 'System Architecture'", () => {
    render(<ArchitectureSection />);
    expect(screen.getByText("System Architecture")).toBeInTheDocument();
  });

  it("renders five architecture node labels", () => {
    render(<ArchitectureSection />);
    expect(screen.getByText("Client SDK")).toBeInTheDocument();
    expect(screen.getByText("Connection Manager")).toBeInTheDocument();
    expect(screen.getByText("Sync Engine")).toBeInTheDocument();
    expect(screen.getByText("Persistence")).toBeInTheDocument();
    expect(screen.getByText("Cache")).toBeInTheDocument();
  });

  it("renders descriptions for each node", () => {
    render(<ArchitectureSection />);
    expect(
      screen.getByText("Channel multiplexing & offline queue")
    ).toBeInTheDocument();
    expect(
      screen.getByText("WebSocket gateway & routing")
    ).toBeInTheDocument();
    expect(
      screen.getByText("CRDT merge & conflict resolution")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/PostgreSQL operations & snapshots/)
    ).toBeInTheDocument();
    expect(
      screen.getByText("Redis state & pub/sub")
    ).toBeInTheDocument();
  });
});
