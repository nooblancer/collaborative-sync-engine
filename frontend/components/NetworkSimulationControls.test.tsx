import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import NetworkSimulationControls from "./NetworkSimulationControls";

describe("NetworkSimulationControls", () => {
  const defaultProps = {
    onCommand: vi.fn(),
    panelClientIds: { left: "client-a", right: "client-b" },
    offlineBufferCount: 0,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    defaultProps.onCommand = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the control panel with header", () => {
    render(<NetworkSimulationControls {...defaultProps} />);
    expect(screen.getByText("Network Simulation")).toBeInTheDocument();
  });

  // --- Latency Slider ---

  it("renders the latency slider with initial value of 0ms", () => {
    render(<NetworkSimulationControls {...defaultProps} />);
    const slider = screen.getByLabelText("Latency injection slider");
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveValue("0");
  });

  it("updates displayed value when latency slider changes", () => {
    render(<NetworkSimulationControls {...defaultProps} />);
    const slider = screen.getByLabelText("Latency injection slider");
    fireEvent.change(slider, { target: { value: "2500" } });
    expect(slider).toHaveValue("2500");
  });

  it("sends set-latency command after debounce", () => {
    render(<NetworkSimulationControls {...defaultProps} />);
    const slider = screen.getByLabelText("Latency injection slider");
    fireEvent.change(slider, { target: { value: "1000" } });

    // Command should not be sent immediately
    expect(defaultProps.onCommand).not.toHaveBeenCalled();

    // After debounce timeout
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(defaultProps.onCommand).toHaveBeenCalledWith({
      type: "set-latency",
      latencyMs: 1000,
    });
  });

  // --- Disconnect Toggle ---

  it("renders disconnect toggle in inactive state", () => {
    render(<NetworkSimulationControls {...defaultProps} />);
    const toggle = screen.getByLabelText("Toggle disconnect simulation");
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("sends disconnect-simulation command when toggled on", () => {
    render(<NetworkSimulationControls {...defaultProps} />);
    const toggle = screen.getByLabelText("Toggle disconnect simulation");
    fireEvent.click(toggle);

    expect(defaultProps.onCommand).toHaveBeenCalledWith({
      type: "disconnect-simulation",
    });
  });

  it("sends reconnect-simulation command when toggled off", () => {
    render(<NetworkSimulationControls {...defaultProps} />);
    const toggle = screen.getByLabelText("Toggle disconnect simulation");

    // Toggle on (disconnect)
    fireEvent.click(toggle);
    // Toggle off (reconnect)
    fireEvent.click(toggle);

    expect(defaultProps.onCommand).toHaveBeenCalledWith({
      type: "reconnect-simulation",
    });
  });

  it("shows disconnected state text when disconnect is active", () => {
    render(<NetworkSimulationControls {...defaultProps} />);
    const toggle = screen.getByLabelText("Toggle disconnect simulation");
    fireEvent.click(toggle);

    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(screen.getByText("Operations queuing offline")).toBeInTheDocument();
  });

  // --- Offline Buffer Counter ---

  it("shows offline buffer counter when disconnected with queued ops", () => {
    render(
      <NetworkSimulationControls {...defaultProps} offlineBufferCount={42} />
    );
    // Not shown when connected
    expect(screen.queryByText("42")).not.toBeInTheDocument();

    // Now disconnect
    const toggle = screen.getByLabelText("Toggle disconnect simulation");
    fireEvent.click(toggle);

    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("ops queued")).toBeInTheDocument();
  });

  it("hides offline buffer counter when count is 0", () => {
    render(
      <NetworkSimulationControls {...defaultProps} offlineBufferCount={0} />
    );
    const toggle = screen.getByLabelText("Toggle disconnect simulation");
    fireEvent.click(toggle);
    expect(screen.queryByText("ops queued")).not.toBeInTheDocument();
  });

  // --- Replay Animation ---

  it("shows replay animation when reconnecting", () => {
    render(<NetworkSimulationControls {...defaultProps} />);
    const toggle = screen.getByLabelText("Toggle disconnect simulation");

    // Disconnect
    fireEvent.click(toggle);
    // Reconnect
    fireEvent.click(toggle);

    expect(screen.getByText("Draining offline queue...")).toBeInTheDocument();
  });

  it("hides replay animation after timeout", () => {
    render(<NetworkSimulationControls {...defaultProps} />);
    const toggle = screen.getByLabelText("Toggle disconnect simulation");

    fireEvent.click(toggle); // disconnect
    fireEvent.click(toggle); // reconnect

    expect(screen.getByText("Draining offline queue...")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.queryByText("Draining offline queue...")).not.toBeInTheDocument();
  });

  // --- Partition Toggle ---

  it("renders partition toggle in inactive state", () => {
    render(<NetworkSimulationControls {...defaultProps} />);
    const toggle = screen.getByLabelText("Toggle network partition simulation");
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("sends partition-simulation command with client groups", () => {
    render(<NetworkSimulationControls {...defaultProps} />);
    const toggle = screen.getByLabelText("Toggle network partition simulation");
    fireEvent.click(toggle);

    expect(defaultProps.onCommand).toHaveBeenCalledWith({
      type: "partition-simulation",
      groupA: ["client-a"],
      groupB: ["client-b"],
    });
  });

  it("sends heal-partition command when partition is deactivated", () => {
    render(<NetworkSimulationControls {...defaultProps} />);
    const toggle = screen.getByLabelText("Toggle network partition simulation");

    fireEvent.click(toggle); // partition
    fireEvent.click(toggle); // heal

    expect(defaultProps.onCommand).toHaveBeenCalledWith({
      type: "heal-partition",
    });
  });

  it("shows partition wall when partitioned", () => {
    render(<NetworkSimulationControls {...defaultProps} />);
    const toggle = screen.getByLabelText("Toggle network partition simulation");
    fireEvent.click(toggle);

    expect(screen.getByText("Partition Wall")).toBeInTheDocument();
  });

  // --- Convergence Animation ---

  it("shows convergence animation when partition heals", () => {
    render(<NetworkSimulationControls {...defaultProps} />);
    const toggle = screen.getByLabelText("Toggle network partition simulation");

    fireEvent.click(toggle); // partition
    fireEvent.click(toggle); // heal

    expect(screen.getByText("Converging states...")).toBeInTheDocument();
  });

  it("hides convergence animation after timeout", () => {
    render(<NetworkSimulationControls {...defaultProps} />);
    const toggle = screen.getByLabelText("Toggle network partition simulation");

    fireEvent.click(toggle); // partition
    fireEvent.click(toggle); // heal

    expect(screen.getByText("Converging states...")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2500);
    });

    expect(screen.queryByText("Converging states...")).not.toBeInTheDocument();
  });

  // --- Mutual Exclusion ---

  it("disables partition toggle when disconnected", () => {
    render(<NetworkSimulationControls {...defaultProps} />);
    const disconnectToggle = screen.getByLabelText("Toggle disconnect simulation");
    const partitionToggle = screen.getByLabelText("Toggle network partition simulation");

    fireEvent.click(disconnectToggle);
    expect(partitionToggle).toBeDisabled();
  });

  it("disables disconnect toggle when partitioned", () => {
    render(<NetworkSimulationControls {...defaultProps} />);
    const disconnectToggle = screen.getByLabelText("Toggle disconnect simulation");
    const partitionToggle = screen.getByLabelText("Toggle network partition simulation");

    fireEvent.click(partitionToggle);
    expect(disconnectToggle).toBeDisabled();
  });

  it("disables latency slider when disconnected", () => {
    render(<NetworkSimulationControls {...defaultProps} />);
    const disconnectToggle = screen.getByLabelText("Toggle disconnect simulation");
    fireEvent.click(disconnectToggle);

    const slider = screen.getByLabelText("Latency injection slider");
    expect(slider).toBeDisabled();
  });
});
