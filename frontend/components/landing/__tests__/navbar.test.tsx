import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Navbar from "../navbar";

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

describe("Navbar", () => {
  it("renders a nav element", () => {
    render(<Navbar />);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("renders the project name", () => {
    render(<Navbar />);
    expect(screen.getByText("Collaborative Sync Engine")).toBeInTheDocument();
  });

  it("renders section navigation links", () => {
    render(<Navbar />);
    expect(screen.getByText("Architecture")).toBeInTheDocument();
    expect(screen.getByText("Features")).toBeInTheDocument();
    expect(screen.getByText("Properties")).toBeInTheDocument();
    expect(screen.getByText("Tech Stack")).toBeInTheDocument();
  });

  it("renders the 'Launch Demo' button link", () => {
    render(<Navbar />);
    expect(screen.getByText("Launch Demo")).toBeInTheDocument();
  });

  it("renders the GitHub link with aria-label", () => {
    render(<Navbar />);
    expect(screen.getByLabelText("GitHub repository")).toBeInTheDocument();
  });
});
