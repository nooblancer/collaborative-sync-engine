/**
 * Integration tests for the GET /health endpoint.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5
 *
 * These tests start the real HTTP server and make actual requests
 * to verify the health endpoint meets UptimeRobot monitoring requirements.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { createServer, type ServerInstanceV2 } from "./index.js";

let server: ServerInstanceV2;
let baseUrl: string;

beforeAll(async () => {
  // Start server on a random available port to avoid conflicts
  server = await createServer({ port: 0 });
  await new Promise<void>((resolve) => {
    server.httpServer.listen(0, () => {
      const addr = server.httpServer.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) {
    await server.stop();
  }
});

/** Helper to make a raw HTTP GET request and return status, headers, and body. */
function httpGet(url: string): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf-8"),
        });
      });
    });
    req.on("error", reject);
  });
}

describe("GET /health integration tests", () => {
  it("returns HTTP 200 status code (Req 4.1)", async () => {
    const res = await httpGet(`${baseUrl}/health`);
    expect(res.statusCode).toBe(200);
  });

  it("returns Content-Type: application/json header (Req 4.5)", async () => {
    const res = await httpGet(`${baseUrl}/health`);
    expect(res.headers["content-type"]).toBe("application/json");
  });

  it("returns JSON body containing status: \"ok\" (Req 4.2)", async () => {
    const res = await httpGet(`${baseUrl}/health`);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("ok");
  });

  it("does not require authentication or JWT (Req 4.4)", async () => {
    // A plain GET request with no Authorization header should succeed
    const res = await httpGet(`${baseUrl}/health`);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("ok");
  });

  it("responds within 5000ms (Req 4.3)", async () => {
    const start = Date.now();
    const res = await httpGet(`${baseUrl}/health`);
    const elapsed = Date.now() - start;

    expect(res.statusCode).toBe(200);
    expect(elapsed).toBeLessThan(5000);
  });
});
