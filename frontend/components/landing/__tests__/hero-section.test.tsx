import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import HeroSection from "../hero-section";

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

describe("HeroSection", () => {
  it("renders the gradient headline", () => {
    render(<HeroSection />);
    expect(screen.getByText("Real-Time Multiplayer")).toBeInTheDocument();
    expect(screen.getByText("Collaboration Engine")).toBeInTheDocument();
  });

  it("renders the description paragraph", () => {
    render(<HeroSection />);
    expect(
      screen.getByText(/Real-time collaborative state synchronization powered by CRDTs/)
    ).toBeInTheDocument();
  });

  it("renders three CTA buttons", () => {
    render(<HeroSection />);
    expect(screen.getByText("Launch Demo")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("View Docs")).toBeInTheDocument();
  });

  it("renders the version badge", () => {
    render(<HeroSection />);
    expect(screen.getByText("Engine v1.0 • Operational")).toBeInTheDocument();
  });
});
