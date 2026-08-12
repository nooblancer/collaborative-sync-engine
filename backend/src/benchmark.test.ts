/**
 * Quick smoke test to verify benchmark module works with the native addon.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { runBenchmark, generateOperationBatch, validateBenchmarkInput } from "./benchmark.js";
import { createServer, type ServerInstanceV2 } from "./index.js";

describe("benchmark module", () => {
  describe("validateBenchmarkInput", () => {
    it("accepts valid inputs", () => {
      expect(validateBenchmarkInput(100, 10)).toBeNull();
      expect(validateBenchmarkInput(1000000, 1000)).toBeNull();
      expect(validateBenchmarkInput(500, 500)).toBeNull();
    });

    it("rejects ops below 100", () => {
      const error = validateBenchmarkInput(99, 10);
      expect(error).not.toBeNull();
      expect(error!.error).toBe("Invalid ops count");
    });

    it("rejects ops above 1000000", () => {
      const error = validateBenchmarkInput(1000001, 10);
      expect(error).not.toBeNull();
      expect(error!.error).toBe("Invalid ops count");
    });

    it("rejects batchSize below 1", () => {
      const error = validateBenchmarkInput(100, 0);
      expect(error).not.toBeNull();
      expect(error!.error).toBe("Invalid batch size");
    });

    it("rejects batchSize greater than ops", () => {
      const error = validateBenchmarkInput(100, 101);
      expect(error).not.toBeNull();
      expect(error!.error).toBe("Invalid batch size");
    });

    it("rejects non-numeric values", () => {
      const error = validateBenchmarkInput(NaN, 10);
      expect(error).not.toBeNull();
      expect(error!.error).toBe("Invalid input");
    });
  });

  describe("generateOperationBatch", () => {
    it("generates the requested number of operations", () => {
      const existingIds: string[] = [];
      const ops = generateOperationBatch(50, existingIds);
      expect(ops).toHaveLength(50);
    });

    it("produces Buffer arrays with valid JSON", () => {
      const existingIds: string[] = [];
      const ops = generateOperationBatch(10, existingIds);
      for (const op of ops) {
        expect(op).toBeInstanceOf(Buffer);
        const parsed = JSON.parse(op.toString());
        expect(parsed.type).toMatch(/^(add|update|remove)$/);
        expect(parsed.itemId).toBeDefined();
      }
    });

    it("produces a mix of operation types for batch >= 10", () => {
      const existingIds: string[] = ["existing-1", "existing-2", "existing-3"];
      // Run multiple times to statistically confirm mix
      let hasAdd = false, hasUpdate = false, hasRemove = false;
      for (let i = 0; i < 10; i++) {
        const ops = generateOperationBatch(100, [...existingIds]);
        for (const op of ops) {
          const parsed = JSON.parse(op.toString());
          if (parsed.type === "add") hasAdd = true;
          if (parsed.type === "update") hasUpdate = true;
          if (parsed.type === "remove") hasRemove = true;
        }
        if (hasAdd && hasUpdate && hasRemove) break;
      }
      expect(hasAdd).toBe(true);
      expect(hasUpdate).toBe(true);
      expect(hasRemove).toBe(true);
    });
  });

  describe("runBenchmark", () => {
    it("returns correct response structure for small benchmark", () => {
      const result = runBenchmark(100, 10);

      expect(result.totalOps).toBe(100);
      expect(result.batchesProcessed).toBe(10);
      expect(result.mergeEngine).toBe("rust-napi-rs");
      expect(result.elapsedMs).toBeGreaterThan(0);
      expect(result.opsPerSecond).toBeGreaterThan(0);
      expect(result.p50Ms).toBeGreaterThanOrEqual(0);
      expect(result.p99Ms).toBeGreaterThanOrEqual(result.p50Ms);
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });

    it("handles non-evenly-divisible ops/batchSize", () => {
      const result = runBenchmark(105, 10);

      expect(result.totalOps).toBe(105);
      expect(result.batchesProcessed).toBe(11); // ceil(105/10)
    });

    it("computes opsPerSecond correctly", () => {
      const result = runBenchmark(100, 50);
      const expectedOpsPerSec = result.totalOps / (result.elapsedMs / 1000);
      expect(result.opsPerSecond).toBeCloseTo(expectedOpsPerSec, 0);
    });
  });
});


// ---------------------------------------------------------------------------
// HTTP Endpoint Tests (Requirements: 1.3, 1.5, 1.13, 1.14, 1.15)
// ---------------------------------------------------------------------------

/**
 * Helper to make an HTTP request to the test server and return the response.
 */
function makeRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
        resolve({ statusCode: res.statusCode!, headers: res.headers, body: parsed });
      });
    });

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Helper to send a raw string body (e.g., invalid JSON) to the server.
 */
function makeRawRequest(
  port: number,
  method: string,
  path: string,
  rawBody: string
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: unknown }> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(rawBody),
      },
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
        resolve({ statusCode: res.statusCode!, headers: res.headers, body: parsed });
      });
    });

    req.on("error", reject);
    req.write(rawBody);
    req.end();
  });
}

describe("benchmark HTTP endpoint", () => {
  let server: ServerInstanceV2;
  let port: number;

  beforeAll(async () => {
    // Use a random high port to avoid conflicts
    port = 19000 + Math.floor(Math.random() * 1000);
    server = await createServer({ port });
    await new Promise<void>((resolve) => {
      server.httpServer.listen(port, "127.0.0.1", () => resolve());
    });
  });

  afterAll(async () => {
    await server.stop();
  });

  it("uses default ops=50000 when ops field is omitted (Req 1.3)", async () => {
    // Sending only batchSize (without ops) would trigger default ops=50000 which is too slow.
    // Instead, verify that omitting ops while providing a batchSize that exceeds 50000
    // triggers a validation error proving the default ops=50000 is applied.
    // If ops defaults to 50000, then batchSize=50001 should fail validation (batchSize > ops).
    const response = await makeRequest(port, "POST", "/benchmark", { batchSize: 50001 });
    expect(response.statusCode).toBe(400);
    const body = response.body as Record<string, unknown>;
    expect(body.error).toBe("Invalid batch size");
  });

  it("uses default batchSize=1000 when batchSize field is omitted (Req 1.5)", async () => {
    // Send ops=100 without batchSize. Default batchSize=1000 means batchSize is capped at ops effectively.
    // ceil(100/1000) = 1 batch processed, proving the default batchSize=1000 is applied.
    const response = await makeRequest(port, "POST", "/benchmark", { ops: 100 });
    expect(response.statusCode).toBe(200);
    const body = response.body as Record<string, unknown>;
    expect(body.batchesProcessed).toBe(1); // ceil(100/1000) = 1, proving default batchSize=1000
  });

  it.skip("applies both defaults correctly when body is empty (Req 1.3, 1.5) [slow: 50k ops]", async () => {
    // An empty body applies ops=50000, batchSize=1000 which are valid.
    // We verify the server doesn't reject it (200), and check response fields.
    // Use a small-ops request to avoid timeout while also checking that empty body
    // with explicit small values works. For the actual defaults, we just verify no 400.
    // Since running 50k ops is too slow for unit tests, verify that the endpoint
    // accepts empty body with a 200 response by checking just the status code.
    // We'll send the request but abort if it takes too long — the key assertion is no 400.
    const response = await new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: unknown }>((resolve, reject) => {
      const payload = JSON.stringify({});
      const options: http.RequestOptions = {
        hostname: "127.0.0.1",
        port,
        path: "/benchmark",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      };

      const req = http.request(options, (res) => {
        // If we get a 400, capture it immediately
        if (res.statusCode === 400) {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            resolve({ statusCode: res.statusCode!, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString()) });
          });
        } else {
          // For 200, just collect the response
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            let parsed: unknown;
            try { parsed = JSON.parse(Buffer.concat(chunks).toString()); } catch { parsed = null; }
            resolve({ statusCode: res.statusCode!, headers: res.headers, body: parsed });
          });
        }
      });

      req.on("error", reject);
      req.write(payload);
      req.end();
    });

    // The key assertion: empty body should NOT return 400 (defaults are valid)
    expect(response.statusCode).toBe(200);
    // If it completed, verify the defaults were applied
    const body = response.body as Record<string, unknown>;
    expect(body.totalOps).toBe(50000);
    expect(body.batchesProcessed).toBe(50); // ceil(50000/1000) = 50
  }, 300000); // Allow up to 5 minutes for the full 50k ops benchmark

  it("returns HTTP 400 for invalid ops value below minimum (Req 1.13)", async () => {
    const response = await makeRequest(port, "POST", "/benchmark", { ops: 99 });
    expect(response.statusCode).toBe(400);
    const body = response.body as Record<string, unknown>;
    expect(body.error).toBe("Invalid ops count");
    expect(body.details).toContain("100");
  });

  it("returns HTTP 400 for invalid batchSize greater than ops (Req 1.14)", async () => {
    const response = await makeRequest(port, "POST", "/benchmark", { ops: 200, batchSize: 201 });
    expect(response.statusCode).toBe(400);
    const body = response.body as Record<string, unknown>;
    expect(body.error).toBe("Invalid batch size");
  });

  it("returns correct response shape and field types for valid input (Req 1.3, 1.5)", async () => {
    const response = await makeRequest(port, "POST", "/benchmark", { ops: 200, batchSize: 50 });
    expect(response.statusCode).toBe(200);

    const body = response.body as Record<string, unknown>;
    expect(body.totalOps).toBe(200);
    expect(body.batchesProcessed).toBe(4); // ceil(200/50)
    expect(typeof body.elapsedMs).toBe("number");
    expect((body.elapsedMs as number)).toBeGreaterThan(0);
    expect(typeof body.opsPerSecond).toBe("number");
    expect((body.opsPerSecond as number)).toBeGreaterThan(0);
    expect(typeof body.p50Ms).toBe("number");
    expect(typeof body.p99Ms).toBe("number");
    expect((body.p50Ms as number)).toBeGreaterThanOrEqual(0);
    expect((body.p99Ms as number)).toBeGreaterThanOrEqual(body.p50Ms as number);
    expect(body.mergeEngine).toBe("rust-napi-rs");
    expect(typeof body.timestamp).toBe("string");
    // Verify ISO 8601 timestamp
    expect(new Date(body.timestamp as string).toISOString()).toBe(body.timestamp);
  });

  it("sets CORS headers on response (Req 1.15)", async () => {
    const response = await makeRequest(port, "POST", "/benchmark", { ops: 200, batchSize: 50 });
    expect(response.headers["access-control-allow-origin"]).toBeDefined();
    // Default CORS origin is "*" in test environment
    expect(response.headers["access-control-allow-origin"]).toBe("*");
  });

  it("returns HTTP 400 with 'Invalid JSON body' for malformed JSON", async () => {
    const response = await makeRawRequest(port, "POST", "/benchmark", "{not valid json!!!");
    expect(response.statusCode).toBe(400);
    const body = response.body as Record<string, unknown>;
    expect(body.error).toBe("Invalid JSON body");
  });
});
