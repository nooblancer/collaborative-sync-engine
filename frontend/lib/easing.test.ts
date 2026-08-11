import { describe, it, expect } from "vitest";
import { easeOut } from "./easing";

describe("easeOut", () => {
  it("returns 0 when t is 0", () => {
    expect(easeOut(0)).toBe(0);
  });

  it("returns 1 when t is 1", () => {
    expect(easeOut(1)).toBe(1);
  });

  it("returns value between 0 and 1 for mid-progress", () => {
    const result = easeOut(0.5);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it("produces values greater than linear for ease-out (front-loaded)", () => {
    // Ease-out should be ahead of linear at t=0.5
    const result = easeOut(0.5);
    expect(result).toBeGreaterThan(0.5);
  });

  it("is monotonically increasing", () => {
    const steps = 100;
    let prev = easeOut(0);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const current = easeOut(t);
      expect(current).toBeGreaterThanOrEqual(prev);
      prev = current;
    }
  });

  it("clamps values below 0 to 0", () => {
    expect(easeOut(-0.5)).toBe(0);
    expect(easeOut(-1)).toBe(0);
  });

  it("clamps values above 1 to 1", () => {
    expect(easeOut(1.5)).toBe(1);
    expect(easeOut(2)).toBe(1);
  });

  it("decelerates (rate of change decreases over time)", () => {
    // Check that the difference between consecutive steps decreases
    const steps = 10;
    const deltas: number[] = [];

    for (let i = 1; i <= steps; i++) {
      const prev = easeOut((i - 1) / steps);
      const current = easeOut(i / steps);
      deltas.push(current - prev);
    }

    // Each delta should be less than or equal to the previous one
    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i]).toBeLessThanOrEqual(deltas[i - 1] + 1e-10);
    }
  });
});
