import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import OperationFlowVisualizer, {
  getOperationColor,
} from "./OperationFlowVisualizer";

// Mock ResizeObserver
class MockResizeObserver {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OperationFlowVisualizer", () => {
  it("renders all architecture nodes", () => {
    render(<OperationFlowVisualizer />);

    expect(screen.getByText("Client")).toBeInTheDocument();
    expect(screen.getByText("WebSocket")).toBeInTheDocument();
    expect(screen.getByText("Batch Processor")).toBeInTheDocument();
    expect(screen.getByText("Sync Engine")).toBeInTheDocument();
    expect(screen.getByText("Persistence")).toBeInTheDocument();
    expect(screen.getByText("Broadcast")).toBeInTheDocument();
  });

  it("renders nodes in correct order (left to right)", () => {
    render(<OperationFlowVisualizer />);

    const labels = screen.getAllByText(
      /Client|WebSocket|Batch Processor|Sync Engine|Persistence|Broadcast/
    );
    const labelTexts = labels.map((el) => el.textContent);

    expect(labelTexts).toEqual([
      "Client",
      "WebSocket",
      "Batch Processor",
      "Sync Engine",
      "Persistence",
      "Broadcast",
    ]);
  });

  it("renders connection edges as SVG lines", () => {
    const { container } = render(<OperationFlowVisualizer />);

    // Select lines with dashed stroke (our edge lines use strokeDasharray)
    const svg = container.querySelector("svg");
    const lines = svg?.querySelectorAll('line[stroke-dasharray]');
    // 5 edges connecting 6 nodes
    expect(lines?.length).toBe(5);
  });

  it("renders the color legend", () => {
    render(<OperationFlowVisualizer />);

    expect(screen.getByText("create")).toBeInTheDocument();
    expect(screen.getByText("update")).toBeInTheDocument();
    expect(screen.getByText("delete")).toBeInTheDocument();
  });

  it("has accessible role and label", () => {
    render(<OperationFlowVisualizer />);

    const visualizer = screen.getByRole("img");
    expect(visualizer).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Operation flow visualizer")
    );
  });

  it("applies custom className", () => {
    const { container } = render(
      <OperationFlowVisualizer className="my-custom-class" />
    );

    const wrapper = container.firstElementChild;
    expect(wrapper?.classList.contains("my-custom-class")).toBe(true);
  });

  it("renders SVG with glow filter definition", () => {
    const { container } = render(<OperationFlowVisualizer />);

    const filter = container.querySelector("#glow-blur");
    expect(filter).toBeInTheDocument();
  });

  it("renders flow-indicators group for animation", () => {
    const { container } = render(<OperationFlowVisualizer />);

    const group = container.querySelector("#flow-indicators");
    expect(group).toBeInTheDocument();
  });
});

describe("getOperationColor", () => {
  it("returns cyan for create operations", () => {
    expect(getOperationColor("create")).toBe("#00d4ff");
  });

  it("returns white/light for update operations", () => {
    expect(getOperationColor("update")).toBe("#e2e8f0");
  });

  it("returns red for delete operations", () => {
    expect(getOperationColor("delete")).toBe("#ef4444");
  });
});
