import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ConflictVisualizer, {
  ConflictEvent,
  HLCTimestamp,
} from "./ConflictVisualizer";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeHLC(wallTime: number, logical = 0, nodeId = "node-1"): HLCTimestamp {
  return { wallTime, logical, nodeId };
}

function makeConflictEvent(overrides: Partial<ConflictEvent> = {}): ConflictEvent {
  const base: ConflictEvent = {
    id: `conflict-${Math.random().toString(36).slice(2, 10)}`,
    roomId: "room-1",
    timestamp: makeHLC(Date.now()),
    field: "position.x",
    operationA: {
      clientId: "client-alpha",
      value: 100,
      hlc: makeHLC(Date.now() - 10, 1, "node-alpha"),
    },
    operationB: {
      clientId: "client-beta",
      value: 200,
      hlc: makeHLC(Date.now(), 2, "node-beta"),
    },
    winner: "B",
    reason: "Operation B has higher HLC wallTime (1700000010 > 1700000000)",
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConflictVisualizer", () => {
  it("renders instructional text when no events are present", () => {
    render(<ConflictVisualizer events={[]} />);

    expect(screen.getByText("No conflicts yet")).toBeInTheDocument();
    expect(
      screen.getByText(/Conflicts occur when two clients simultaneously edit/)
    ).toBeInTheDocument();
  });

  it("renders conflict events when provided", () => {
    const events = [
      makeConflictEvent({ id: "c1", field: "position.x" }),
      makeConflictEvent({ id: "c2", field: "style.fill" }),
    ];

    render(<ConflictVisualizer events={events} />);

    expect(screen.getByText("position.x")).toBeInTheDocument();
    expect(screen.getByText("style.fill")).toBeInTheDocument();
  });

  it("shows expanded details when a conflict event is clicked", () => {
    const event = makeConflictEvent({
      id: "c1",
      field: "position.y",
      reason: "Higher HLC timestamp wins",
    });

    render(<ConflictVisualizer events={[event]} />);

    // Click to expand
    const button = screen.getByRole("button", { expanded: false });
    fireEvent.click(button);

    // Should now show operation details
    expect(screen.getByText("Op A")).toBeInTheDocument();
    expect(screen.getByText("Op B")).toBeInTheDocument();
    // Reason should appear in the expanded detail section
    expect(screen.getAllByText("Higher HLC timestamp wins").length).toBeGreaterThanOrEqual(1);
  });

  it("highlights the winner with glow and shows loser at reduced opacity", () => {
    const event = makeConflictEvent({
      id: "c1",
      winner: "A",
    });

    render(<ConflictVisualizer events={[event]} />);

    // Expand the event
    const button = screen.getByRole("button");
    fireEvent.click(button);

    // Find operation cards by their labels
    const opALabel = screen.getByText("Op A");
    const opBLabel = screen.getByText("Op B");

    // Winner card (Op A) should have glow styling
    const winnerCard = opALabel.closest("[class*='shadow-glow']");
    expect(winnerCard).not.toBeNull();

    // Loser card (Op B) should have opacity-50
    const loserCard = opBLabel.closest("[class*='opacity-50']");
    expect(loserCard).not.toBeNull();
  });

  it("limits displayed events to maxHistory (default 20)", () => {
    const events = Array.from({ length: 25 }, (_, i) =>
      makeConflictEvent({ id: `c${i}`, field: `field-${i}` })
    );

    render(<ConflictVisualizer events={events} maxHistory={20} />);

    // Should show counter
    expect(screen.getByText("20/20 events")).toBeInTheDocument();

    // Should show the last 20 events (field-5 through field-24)
    expect(screen.queryByText("field-0")).not.toBeInTheDocument();
    expect(screen.queryByText("field-4")).not.toBeInTheDocument();
    expect(screen.getByText("field-5")).toBeInTheDocument();
    expect(screen.getByText("field-24")).toBeInTheDocument();
  });

  it("respects custom maxHistory prop", () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      makeConflictEvent({ id: `c${i}`, field: `field-${i}` })
    );

    render(<ConflictVisualizer events={events} maxHistory={5} />);

    expect(screen.getByText("5/5 events")).toBeInTheDocument();
    // Only last 5 should be visible
    expect(screen.queryByText("field-0")).not.toBeInTheDocument();
    expect(screen.getByText("field-5")).toBeInTheDocument();
    expect(screen.getByText("field-9")).toBeInTheDocument();
  });

  it("displays human-readable resolution explanation", () => {
    const event = makeConflictEvent({
      id: "c1",
      reason: "Operation B wins: higher wallTime (1700000010 > 1700000000), tiebreak not needed",
    });

    render(<ConflictVisualizer events={[event]} />);

    // Reason appears in collapsed view
    expect(
      screen.getByText(
        "Operation B wins: higher wallTime (1700000010 > 1700000000), tiebreak not needed"
      )
    ).toBeInTheDocument();
  });

  it("displays HLC timestamps for operations", () => {
    const event = makeConflictEvent({
      id: "c1",
      operationA: {
        clientId: "alice",
        value: 42,
        hlc: makeHLC(1700000000000, 3, "node-alice"),
      },
      operationB: {
        clientId: "bob",
        value: 99,
        hlc: makeHLC(1700000001000, 1, "node-bob"),
      },
    });

    render(<ConflictVisualizer events={[event]} />);

    // Expand to see timestamps
    const button = screen.getByRole("button");
    fireEvent.click(button);

    // Values should be displayed
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("99")).toBeInTheDocument();
  });

  it("shows winner badge on expanded event", () => {
    const event = makeConflictEvent({ id: "c1", winner: "B" });

    render(<ConflictVisualizer events={[event]} />);

    // Winner indicator in the collapsed header
    expect(screen.getByText("Winner: B")).toBeInTheDocument();
  });
});
