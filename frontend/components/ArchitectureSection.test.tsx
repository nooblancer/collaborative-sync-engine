import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ArchitectureSection, {
  ARCHITECTURE_NODES,
  ARCHITECTURE_EDGES,
  getNodeById,
  getConnectedEdges,
  getConnectedNodes,
} from "./ArchitectureSection";

// Mock IntersectionObserver
let intersectionCallback: IntersectionObserverCallback;

class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    intersectionCallback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function triggerInView() {
  intersectionCallback(
    [{ isIntersecting: true } as IntersectionObserverEntry],
    {} as IntersectionObserver
  );
}

describe("ArchitectureSection", () => {
  it("renders all five architecture nodes", () => {
    render(<ArchitectureSection />);

    expect(screen.getByText("Client SDK")).toBeInTheDocument();
    expect(screen.getByText("Connection Manager")).toBeInTheDocument();
    expect(screen.getByText("Sync Engine")).toBeInTheDocument();
    expect(screen.getByText("Persistence")).toBeInTheDocument();
    expect(screen.getByText("Cache")).toBeInTheDocument();
  });

  it("renders section heading and description", () => {
    render(<ArchitectureSection />);

    expect(screen.getByText("System Architecture")).toBeInTheDocument();
    expect(
      screen.getByText(/Data flows through five core components/)
    ).toBeInTheDocument();
  });

  it("renders node descriptions", () => {
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
      screen.getByText("PostgreSQL operations & snapshots")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Redis state & pub/sub")
    ).toBeInTheDocument();
  });

  it("renders edge labels in SVG", () => {
    const { container } = render(<ArchitectureSection />);

    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();

    // Edge labels rendered as SVG text elements
    const textElements = svg?.querySelectorAll("text");
    const labels = Array.from(textElements || []).map(
      (t) => t.textContent
    );

    expect(labels).toContain("WebSocket frames");
    expect(labels).toContain("Routed operations");
    expect(labels).toContain("Persist ops & snapshots");
    expect(labels).toContain("State updates");
    expect(labels).toContain("Broadcast deltas");
    expect(labels).toContain("Merged deltas");
  });

  it("renders edges with directional arrowhead markers", () => {
    const { container } = render(<ArchitectureSection />);

    const svg = container.querySelector("svg");
    // Check that arrowhead markers are defined
    const arrowMarker = svg?.querySelector("#arch-arrowhead");
    const activeMarker = svg?.querySelector("#arch-arrowhead-active");
    expect(arrowMarker).toBeInTheDocument();
    expect(activeMarker).toBeInTheDocument();

    // Visible edge paths should reference arrowhead marker
    const paths = svg?.querySelectorAll('path[marker-end]');
    expect(paths?.length).toBeGreaterThan(0);
  });

  it("displays tooltip on node hover", () => {
    render(<ArchitectureSection />);

    const clientNode = screen.getByTestId("node-client-sdk");
    fireEvent.mouseEnter(clientNode);

    // Tooltip should show the technical details
    expect(
      screen.getByText(/Manages WebSocket connection with channel multiplexing/)
    ).toBeInTheDocument();
  });

  it("hides tooltip on node mouse leave", () => {
    render(<ArchitectureSection />);

    const clientNode = screen.getByTestId("node-client-sdk");
    fireEvent.mouseEnter(clientNode);
    fireEvent.mouseLeave(clientNode);

    expect(
      screen.queryByText(
        /Manages WebSocket connection with channel multiplexing/
      )
    ).not.toBeInTheDocument();
  });

  it("displays tooltip on edge hover", () => {
    const { container } = render(<ArchitectureSection />);

    // Find the hit-area path for the first edge
    const edgeGroup = container.querySelector(
      '[data-testid="edge-client-to-conn"]'
    );
    const hitArea = edgeGroup?.querySelector(
      'path[stroke="transparent"]'
    );
    expect(hitArea).toBeInTheDocument();

    fireEvent.mouseEnter(hitArea!);

    expect(
      screen.getByText(
        /JSON-multiplexed WebSocket frames over single connection per room/
      )
    ).toBeInTheDocument();
  });

  it("has accessible section label", () => {
    render(<ArchitectureSection />);

    const section = screen.getByRole("region", {
      name: "System architecture diagram",
    });
    expect(section).toBeInTheDocument();
  });

  it("renders interaction hint text", () => {
    render(<ArchitectureSection />);

    expect(
      screen.getByText(
        "Hover over nodes and edges to explore component details"
      )
    ).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <ArchitectureSection className="my-custom" />
    );

    const section = container.querySelector("section");
    expect(section?.classList.contains("my-custom")).toBe(true);
  });

  it("nodes start hidden (opacity 0) before scroll trigger", () => {
    const { container } = render(<ArchitectureSection />);

    const firstNode = container.querySelector(
      '[data-testid="node-client-sdk"]'
    );
    // Before intersection, node should have opacity 0
    expect(firstNode?.style.opacity).toBe("0");
  });

  it("nodes become visible after scroll-triggered intersection", () => {
    const { container } = render(<ArchitectureSection />);

    act(() => {
      triggerInView();
    });

    const firstNode = container.querySelector(
      '[data-testid="node-client-sdk"]'
    );
    // After intersection, node should be visible (opacity 1 or with dimming 0.4)
    expect(firstNode?.style.opacity).not.toBe("0");
  });
});

describe("getNodeById", () => {
  it("returns the correct node for a valid ID", () => {
    const node = getNodeById("sync-engine");
    expect(node).toBeDefined();
    expect(node?.label).toBe("Sync Engine");
  });

  it("returns undefined for an invalid ID", () => {
    const node = getNodeById("nonexistent");
    expect(node).toBeUndefined();
  });
});

describe("getConnectedEdges", () => {
  it("returns edge IDs connected to a node", () => {
    const edges = getConnectedEdges("client-sdk");
    expect(edges).toContain("client-to-conn");
    expect(edges).toContain("conn-to-client");
  });

  it("returns empty array for a node with no edges", () => {
    const edges = getConnectedEdges("nonexistent");
    expect(edges).toHaveLength(0);
  });
});

describe("getConnectedNodes", () => {
  it("returns node IDs connected to the given node", () => {
    const nodes = getConnectedNodes("sync-engine");
    expect(nodes).toContain("connection-manager");
    expect(nodes).toContain("persistence");
    expect(nodes).toContain("cache");
  });

  it("returns empty array for an unconnected node", () => {
    const nodes = getConnectedNodes("nonexistent");
    expect(nodes).toHaveLength(0);
  });
});

describe("ARCHITECTURE_NODES", () => {
  it("contains exactly 5 nodes", () => {
    expect(ARCHITECTURE_NODES).toHaveLength(5);
  });

  it("all nodes have required fields", () => {
    for (const node of ARCHITECTURE_NODES) {
      expect(node.id).toBeTruthy();
      expect(node.label).toBeTruthy();
      expect(node.description).toBeTruthy();
      expect(node.tooltip).toBeTruthy();
      expect(node.icon).toBeDefined();
      expect(typeof node.x).toBe("number");
      expect(typeof node.y).toBe("number");
    }
  });
});

describe("ARCHITECTURE_EDGES", () => {
  it("contains exactly 6 edges", () => {
    expect(ARCHITECTURE_EDGES).toHaveLength(6);
  });

  it("all edges reference valid nodes", () => {
    for (const edge of ARCHITECTURE_EDGES) {
      expect(getNodeById(edge.from)).toBeDefined();
      expect(getNodeById(edge.to)).toBeDefined();
    }
  });

  it("all edges have labels and tooltips", () => {
    for (const edge of ARCHITECTURE_EDGES) {
      expect(edge.label).toBeTruthy();
      expect(edge.tooltip).toBeTruthy();
    }
  });
});
