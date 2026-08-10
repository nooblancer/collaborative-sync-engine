import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import PropertiesSection from "../properties-section";

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

describe("PropertiesSection", () => {
  it("renders the heading 'Verified CRDT Properties'", () => {
    render(<PropertiesSection />);
    expect(screen.getByText("Verified CRDT Properties")).toBeInTheDocument();
  });

  it("renders 21 property rows", () => {
    render(<PropertiesSection />);
    // Spot-check specific property names
    expect(screen.getByText("Commutativity")).toBeInTheDocument();
    expect(screen.getByText("Convergence")).toBeInTheDocument();
    expect(screen.getByText("Idempotency")).toBeInTheDocument();
  });

  it("renders all 21 property entries", () => {
    render(<PropertiesSection />);
    const propertyNames = [
      "Commutativity",
      "Associativity",
      "Idempotency",
      "Convergence",
      "Causal Ordering",
      "Last-Writer-Wins",
      "Monotonic Clock",
      "Bounded Drift",
      "Add Uniqueness",
      "Remove Semantics",
      "Update Atomicity",
      "Delta Minimality",
      "Delta Completeness",
      "Merge Determinism",
      "State Validity",
      "Operation Integrity",
      "Offline Accumulation",
      "Reconnection Sync",
      "Concurrent Safety",
      "Snapshot Consistency",
      "Ordering Preservation",
    ];
    for (const name of propertyNames) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });
});
