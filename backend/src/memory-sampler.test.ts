/**
 * Unit tests for MemorySampler utility.
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.6
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { MemorySampler } from "./memory-sampler";

describe("MemorySampler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records baseline and returns metrics after sampling", () => {
    const sampler = new MemorySampler();
    sampler.recordBaseline();
    sampler.sample();

    const results = sampler.getResults();
    expect(results.memoryPeakMb).toBeTypeOf("number");
    expect(results.memoryDeltaMb).toBeTypeOf("number");
    expect(results.memoryPeakMb).toBeGreaterThan(0);
    expect(results.memoryDeltaMb).toBeGreaterThanOrEqual(0);
    expect(results.memoryError).toBeUndefined();
  });

  it("returns values rounded to 2 decimal places", () => {
    const sampler = new MemorySampler();
    sampler.recordBaseline();
    sampler.sample();

    const results = sampler.getResults();
    if (results.memoryPeakMb !== null) {
      const peakStr = results.memoryPeakMb.toString();
      const decimals = peakStr.includes(".") ? peakStr.split(".")[1].length : 0;
      expect(decimals).toBeLessThanOrEqual(2);
    }
    if (results.memoryDeltaMb !== null) {
      const deltaStr = results.memoryDeltaMb.toString();
      const decimals = deltaStr.includes(".") ? deltaStr.split(".")[1].length : 0;
      expect(decimals).toBeLessThanOrEqual(2);
    }
  });

  it("retains peak across multiple samples", () => {
    // We'll mock process.memoryUsage to return controlled values
    const mockValues = [
      { heapUsed: 10 * 1024 * 1024 },  // baseline: 10 MB
      { heapUsed: 15 * 1024 * 1024 },  // sample 1: 15 MB
      { heapUsed: 12 * 1024 * 1024 },  // sample 2: 12 MB (lower than peak)
      { heapUsed: 20 * 1024 * 1024 },  // sample 3: 20 MB (new peak)
      { heapUsed: 18 * 1024 * 1024 },  // sample 4: 18 MB (lower than peak)
    ];
    let callIndex = 0;

    vi.spyOn(process, "memoryUsage").mockImplementation(() => {
      const val = mockValues[callIndex++];
      return {
        heapUsed: val.heapUsed,
        rss: 0,
        heapTotal: 0,
        external: 0,
        arrayBuffers: 0,
      };
    });

    const sampler = new MemorySampler();
    sampler.recordBaseline();
    sampler.sample();
    sampler.sample();
    sampler.sample();
    sampler.sample();

    const results = sampler.getResults();
    expect(results.memoryPeakMb).toBe(20);
    expect(results.memoryDeltaMb).toBe(10); // 20 MB - 10 MB
  });

  it("returns null fields and memoryError when process.memoryUsage throws on baseline", () => {
    vi.spyOn(process, "memoryUsage").mockImplementation(() => {
      throw new Error("memoryUsage not available");
    });

    const sampler = new MemorySampler();
    sampler.recordBaseline();

    const results = sampler.getResults();
    expect(results.memoryPeakMb).toBeNull();
    expect(results.memoryDeltaMb).toBeNull();
    expect(results.memoryError).toBe("memoryUsage not available");
  });

  it("returns null fields and memoryError when process.memoryUsage throws during sample", () => {
    let callCount = 0;
    vi.spyOn(process, "memoryUsage").mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // baseline succeeds
        return {
          heapUsed: 10 * 1024 * 1024,
          rss: 0,
          heapTotal: 0,
          external: 0,
          arrayBuffers: 0,
        };
      }
      throw new Error("memory read failed");
    });

    const sampler = new MemorySampler();
    sampler.recordBaseline();
    sampler.sample(); // This should trigger the error

    const results = sampler.getResults();
    expect(results.memoryPeakMb).toBeNull();
    expect(results.memoryDeltaMb).toBeNull();
    expect(results.memoryError).toBe("memory read failed");
  });

  it("skips sampling after an error has occurred", () => {
    vi.spyOn(process, "memoryUsage").mockImplementation(() => {
      throw new Error("unavailable");
    });

    const sampler = new MemorySampler();
    sampler.recordBaseline(); // fails
    sampler.sample(); // should be a no-op

    const results = sampler.getResults();
    expect(results.memoryPeakMb).toBeNull();
    expect(results.memoryDeltaMb).toBeNull();
    expect(results.memoryError).toBe("unavailable");
  });

  it("handles non-Error thrown values gracefully", () => {
    vi.spyOn(process, "memoryUsage").mockImplementation(() => {
      throw "string error";
    });

    const sampler = new MemorySampler();
    sampler.recordBaseline();

    const results = sampler.getResults();
    expect(results.memoryPeakMb).toBeNull();
    expect(results.memoryDeltaMb).toBeNull();
    expect(results.memoryError).toBe("Failed to read memory usage");
  });

  it("computes correct values for known heap sizes", () => {
    // 5,242,880 bytes = 5 MB exactly
    // 7,864,320 bytes = 7.5 MB exactly
    const mockValues = [
      { heapUsed: 5242880 },   // baseline: 5 MB
      { heapUsed: 7864320 },   // peak: 7.5 MB
    ];
    let callIndex = 0;

    vi.spyOn(process, "memoryUsage").mockImplementation(() => {
      const val = mockValues[callIndex++];
      return {
        heapUsed: val.heapUsed,
        rss: 0,
        heapTotal: 0,
        external: 0,
        arrayBuffers: 0,
      };
    });

    const sampler = new MemorySampler();
    sampler.recordBaseline();
    sampler.sample();

    const results = sampler.getResults();
    expect(results.memoryPeakMb).toBe(7.5);
    expect(results.memoryDeltaMb).toBe(2.5);
  });

  it("returns zero delta when peak equals baseline", () => {
    const fixedHeap = 10 * 1024 * 1024; // 10 MB
    vi.spyOn(process, "memoryUsage").mockImplementation(() => ({
      heapUsed: fixedHeap,
      rss: 0,
      heapTotal: 0,
      external: 0,
      arrayBuffers: 0,
    }));

    const sampler = new MemorySampler();
    sampler.recordBaseline();
    sampler.sample();

    const results = sampler.getResults();
    expect(results.memoryPeakMb).toBe(10);
    expect(results.memoryDeltaMb).toBe(0);
  });
});
