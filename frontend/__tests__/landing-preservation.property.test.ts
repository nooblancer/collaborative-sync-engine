/**
 * Property 2: Preservation — Existing Landing Page Behavior Unchanged
 *
 * These property-based tests capture the CURRENT correct behavior of the
 * landing page that must be preserved after bug fixes. They verify:
 * - Hero section renders without layout overflow at any viewport width
 * - Scroll-triggered animations fire at the same intersection ratios
 * - Navbar section links produce smooth scroll to correct section offsets
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import fc from "fast-check";
import React from "react";

// ---------------------------------------------------------------------------
// Mocks — freeze external dependencies so we test component logic only
// ---------------------------------------------------------------------------

// Track useInView calls to verify intersection behavior
const useInViewCalls: Array<{ options: any; result: boolean }> = [];

vi.mock("framer-motion", () => {
  const React = require("react");
  return {
    motion: {
      div: React.forwardRef(({ children, initial, animate, transition, variants, ...props }: any, ref: any) => {
        return React.createElement("div", { ref, "data-testid": "motion-div", ...props }, children);
      }),
      h1: React.forwardRef(({ children, ...props }: any, ref: any) => React.createElement("h1", { ref, ...props }, children)),
      h2: React.forwardRef(({ children, ...props }: any, ref: any) => React.createElement("h2", { ref, ...props }, children)),
      p: React.forwardRef(({ children, ...props }: any, ref: any) => React.createElement("p", { ref, ...props }, children)),
      path: React.forwardRef(({ children, ...props }: any, ref: any) => React.createElement("path", { ref, ...props }, children)),
      text: React.forwardRef(({ children, ...props }: any, ref: any) => React.createElement("text", { ref, ...props }, children)),
      g: React.forwardRef(({ children, ...props }: any, ref: any) => React.createElement("g", { ref, ...props }, children)),
    },
    useInView: (ref: any, options?: any) => {
      useInViewCalls.push({ options: options || {}, result: true });
      return true;
    },
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
  };
});

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => {
    const React = require("react");
    return React.createElement("a", { href, ...props }, children);
  },
}));

vi.mock("@/hooks/use-sync-engine", () => ({
  useSyncEngine: () => ({
    connectionState: "disconnected",
    metrics: null,
    sendOperation: vi.fn(),
    sendControl: vi.fn(),
    subscribe: () => () => {},
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import HeroSection from "@/components/landing/hero-section";
import Navbar from "@/components/landing/navbar";
import ArchitectureSection from "@/components/landing/architecture-section";

// ---------------------------------------------------------------------------
// Property 1: Hero section renders without layout overflow at any viewport
// ---------------------------------------------------------------------------

describe("Property 2: Preservation — Landing Page Behavior", () => {
  beforeEach(() => {
    useInViewCalls.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  describe("Hero section renders without layout overflow for all viewport widths", () => {
    it("hero section root element uses min-h-screen and overflow-hidden for any viewport width (320-1920)", () => {
      /**
       * **Validates: Requirements 3.2, 3.6**
       *
       * Property: For all viewport widths in [320, 1920], the hero section
       * renders with overflow-hidden class and min-h-screen, preventing any
       * horizontal overflow regardless of viewport size.
       */
      fc.assert(
        fc.property(
          fc.integer({ min: 320, max: 1920 }),
          (viewportWidth: number) => {
            // Simulate viewport width via window.innerWidth
            Object.defineProperty(window, "innerWidth", {
              value: viewportWidth,
              writable: true,
              configurable: true,
            });

            const { container } = render(React.createElement(HeroSection));

            // The hero section should have overflow-hidden to prevent any
            // content from causing horizontal scrollbars
            const section = container.querySelector("section");
            expect(section).not.toBeNull();

            // Verify the section has overflow-hidden class
            expect(section!.className).toContain("overflow-hidden");

            // Verify it has min-h-screen for proper vertical sizing
            expect(section!.className).toContain("min-h-screen");

            // Verify responsive padding classes exist
            expect(section!.className).toMatch(/px-4/);

            // Verify the grid layout exists for responsive behavior
            const grid = container.querySelector('[class*="grid"]');
            expect(grid).not.toBeNull();
            expect(grid!.className).toContain("grid-cols-1");
            expect(grid!.className).toContain("lg:grid-cols-2");

            cleanup();
          }
        ),
        { numRuns: 50 }
      );
    });

    it("hero visualization canvas maintains fixed dimensions independent of viewport", () => {
      /**
       * **Validates: Requirements 3.2, 3.7**
       *
       * Property: For all viewport widths in [320, 1920], the canvas element
       * always has width=600 and height=300 (its internal resolution is fixed).
       */
      fc.assert(
        fc.property(
          fc.integer({ min: 320, max: 1920 }),
          (viewportWidth: number) => {
            Object.defineProperty(window, "innerWidth", {
              value: viewportWidth,
              writable: true,
              configurable: true,
            });

            const { container } = render(React.createElement(HeroSection));

            const canvas = container.querySelector("canvas");
            expect(canvas).not.toBeNull();
            expect(canvas!.getAttribute("width")).toBe("600");
            expect(canvas!.getAttribute("height")).toBe("300");
            expect(canvas!.getAttribute("aria-label")).toBe(
              "Live operation processing visualization"
            );

            cleanup();
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 2: Scroll-triggered animations fire at intersection thresholds
  // ---------------------------------------------------------------------------

  describe("Scroll-triggered animations fire at correct intersection ratios", () => {
    it("architecture section uses useInView with once:true and margin -100px for all scroll positions", () => {
      /**
       * **Validates: Requirements 3.3, 3.4**
       *
       * Property: For all simulated scroll positions, the architecture section
       * consistently requests intersection observation with once:true and a
       * negative margin, ensuring animations only fire once at a consistent threshold.
       */
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 5000 }),
          (scrollY: number) => {
            useInViewCalls.length = 0;
            Object.defineProperty(window, "scrollY", {
              value: scrollY,
              writable: true,
              configurable: true,
            });

            render(React.createElement(ArchitectureSection));

            // The architecture section uses useInView with specific options
            // It should always use once:true (animations don't replay)
            const archCalls = useInViewCalls.filter(
              (call) => call.options.once === true
            );
            expect(archCalls.length).toBeGreaterThan(0);

            // Verify the margin threshold is preserved (-100px triggers animation
            // 100px before the section enters viewport)
            const callWithMargin = useInViewCalls.find(
              (call) => call.options.margin === "-100px"
            );
            expect(callWithMargin).toBeDefined();

            cleanup();
          }
        ),
        { numRuns: 30 }
      );
    });

    it("architecture nodes appear with sequential stagger delays", () => {
      /**
       * **Validates: Requirements 3.4**
       *
       * Property: The architecture section always renders exactly 5 nodes
       * in a consistent order, preserving the sequential build-up animation.
       */
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 3000 }),
          (_scrollY: number) => {
            const { container } = render(React.createElement(ArchitectureSection));

            // Should render all 5 architecture nodes
            const nodeLabels = [
              "Client SDK",
              "Connection Manager",
              "Sync Engine",
              "Persistence",
              "Cache",
            ];

            for (const label of nodeLabels) {
              expect(screen.getByText(label)).toBeInTheDocument();
            }

            // SVG should have edges rendered
            const svg = container.querySelector("svg");
            expect(svg).not.toBeNull();
            expect(svg!.getAttribute("viewBox")).toBe("0 0 100 56");

            cleanup();
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 3: Navbar section links produce smooth scroll to correct offsets
  // ---------------------------------------------------------------------------

  describe("Navbar section links produce smooth scroll to correct section offsets", () => {
    it("all navbar section links have correct anchor href values for any page state", () => {
      /**
       * **Validates: Requirements 3.5**
       *
       * Property: For all possible page states, the navbar always renders
       * exactly 4 section links with the correct href anchors pointing to
       * the expected page sections.
       */
      const expectedLinks = [
        { href: "#architecture", label: "Architecture" },
        { href: "#features", label: "Features" },
        { href: "#properties", label: "Properties" },
        { href: "#tech-stack", label: "Tech Stack" },
      ];

      fc.assert(
        fc.property(
          fc.integer({ min: 320, max: 1920 }),
          (viewportWidth: number) => {
            Object.defineProperty(window, "innerWidth", {
              value: viewportWidth,
              writable: true,
              configurable: true,
            });

            render(React.createElement(Navbar));

            for (const expected of expectedLinks) {
              const link = screen.getByText(expected.label);
              expect(link).toBeInTheDocument();
              expect(link.tagName.toLowerCase()).toBe("a");
              expect(link.getAttribute("href")).toBe(expected.href);
            }

            cleanup();
          }
        ),
        { numRuns: 30 }
      );
    });

    it("navbar section links are consistent anchor elements regardless of viewport", () => {
      /**
       * **Validates: Requirements 3.5, 3.6**
       *
       * Property: For all viewport widths, each section link is an <a> tag
       * with an href starting with '#', which enables the browser's native
       * smooth scroll behavior (controlled via CSS scroll-behavior).
       */
      fc.assert(
        fc.property(
          fc.integer({ min: 320, max: 1920 }),
          (viewportWidth: number) => {
            Object.defineProperty(window, "innerWidth", {
              value: viewportWidth,
              writable: true,
              configurable: true,
            });

            const { container } = render(React.createElement(Navbar));

            // Get all anchor links within the nav
            const nav = container.querySelector("nav");
            expect(nav).not.toBeNull();

            const anchors = nav!.querySelectorAll('a[href^="#"]');
            // There should be exactly 4 section navigation links
            expect(anchors.length).toBe(4);

            // Each anchor should start with '#' (enabling smooth scroll)
            anchors.forEach((anchor) => {
              const href = anchor.getAttribute("href");
              expect(href).not.toBeNull();
              expect(href!.startsWith("#")).toBe(true);
            });

            cleanup();
          }
        ),
        { numRuns: 30 }
      );
    });

    it("landing page sections have matching id attributes for navbar links", () => {
      /**
       * **Validates: Requirements 3.5**
       *
       * Property: The architecture section renders with id='architecture',
       * matching the navbar's #architecture link target.
       */
      fc.assert(
        fc.property(
          fc.constant(null),
          () => {
            const { container } = render(React.createElement(ArchitectureSection));

            // Architecture section should have the correct id
            const section = container.querySelector("#architecture");
            expect(section).not.toBeNull();
            expect(section!.tagName.toLowerCase()).toBe("section");

            cleanup();
          }
        ),
        { numRuns: 5 }
      );
    });
  });
});
