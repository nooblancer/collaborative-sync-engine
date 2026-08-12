/**
 * Memory Sampler utility for benchmark memory measurement.
 *
 * Wraps `process.memoryUsage().heapUsed` to track baseline and peak heap usage
 * during a benchmark run. Provides graceful degradation if memory measurement
 * is unavailable or throws.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.6
 */

export interface MemoryResults {
  memoryPeakMb: number | null;
  memoryDeltaMb: number | null;
  memoryError?: string;
}

export class MemorySampler {
  private baseline: number | null = null;
  private peak: number | null = null;
  private error: string | null = null;

  /**
   * Records baseline heap memory usage.
   * Should be called after operation generation but before the merge loop.
   * Requirement 2.1
   */
  recordBaseline(): void {
    try {
      const heapUsed = process.memoryUsage().heapUsed;
      this.baseline = heapUsed;
      this.peak = heapUsed;
    } catch (err: unknown) {
      this.error = err instanceof Error ? err.message : "Failed to read memory usage";
      this.baseline = null;
      this.peak = null;
    }
  }

  /**
   * Samples current heap memory and retains the maximum observed value.
   * Should be called after each batch completes during the merge loop.
   * Requirement 2.2
   */
  sample(): void {
    if (this.error !== null) return;

    try {
      const heapUsed = process.memoryUsage().heapUsed;
      if (this.peak === null || heapUsed > this.peak) {
        this.peak = heapUsed;
      }
    } catch (err: unknown) {
      this.error = err instanceof Error ? err.message : "Failed to read memory usage";
      this.baseline = null;
      this.peak = null;
    }
  }

  /**
   * Returns computed memory metrics.
   * - memoryPeakMb: absolute peak heap in MB rounded to 2 decimal places (Req 2.4)
   * - memoryDeltaMb: peak minus baseline in MB rounded to 2 decimal places (Req 2.3)
   * - memoryError: present only when measurement failed (Req 2.6)
   */
  getResults(): MemoryResults {
    if (this.error !== null || this.baseline === null || this.peak === null) {
      const result: MemoryResults = {
        memoryPeakMb: null,
        memoryDeltaMb: null,
      };
      if (this.error) {
        result.memoryError = this.error;
      }
      return result;
    }

    const bytesToMb = (bytes: number): number =>
      Math.round((bytes / (1024 * 1024)) * 100) / 100;

    return {
      memoryPeakMb: bytesToMb(this.peak),
      memoryDeltaMb: bytesToMb(this.peak - this.baseline),
    };
  }
}
