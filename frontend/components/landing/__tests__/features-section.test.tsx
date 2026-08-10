import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import FeaturesSection from "../features-section";

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

describe("FeaturesSection", () => {
  it("renders the heading 'Key Features'", () => {
    render(<FeaturesSection />);
    expect(screen.getByText("Key Features")).toBeInTheDocument();
  });

  it("renders four feature card titles", () => {
    render(<FeaturesSection />);
    expect(screen.getByText("Real-Time Sync")).toBeInTheDocument();
    expect(screen.getByText("Offline Support")).toBeInTheDocument();
    expect(screen.getByText("Conflict Resolution")).toBeInTheDocument();
    expect(screen.getByText("Presence Tracking")).toBeInTheDocument();
  });
});
