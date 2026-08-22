import express from "express";
import type {Server} from "node:http";
import {registerReportingRoutes} from "./reporting-proxy";

const CONFIG = {
  accessCookieName: "jsc-access-local",
  csrfCookieName: "jsc-csrf-local",
  origin: "http://reporting-gateway:8095",
  timeoutMs: 1000,
};
const TOKEN = "header.payload.signature";

describe("Reporting BFF", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
    server = undefined;
    vi.restoreAllMocks();
  });

  async function start(
    fetchImplementation: typeof fetch,
    timeoutMs = CONFIG.timeoutMs,
  ): Promise<string> {
    const app = express();
    registerReportingRoutes(app, {...CONFIG, timeoutMs}, fetchImplementation);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server?.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    return `http://127.0.0.1:${address.port}`;
  }

  it("derives credentials only from the HttpOnly session cookie", async () => {
    let forwarded: RequestInit | undefined;
    const origin = await start((async (_input, init) => {
      forwarded = init;
      return new Response(JSON.stringify({applicationSummary: {total: 1}, activityTimeline: []}), {
        status: 200,
        headers: {"Content-Type": "application/json"},
      });
    }) as typeof fetch);

    const response = await fetch(`${origin}/api/v1/reports/summary`, {
      headers: {
        Cookie: `jsc-access-local=${TOKEN}`,
        Authorization: "Bearer browser-controlled",
        "X-User-Id": "another-user",
      },
    });

    expect(response.status).toBe(200);
    expect(forwarded?.headers).toEqual({
      Accept: "application/json",
      Authorization: `Bearer ${TOKEN}`,
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects requests without one valid session cookie", async () => {
    const origin = await start((async () => {
      throw new Error("must not reach downstream");
    }) as typeof fetch);

    const response = await fetch(`${origin}/api/v1/reports/summary`, {
      headers: {Authorization: "Bearer browser-controlled", "X-User-Id": "another-user"},
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "SESSION_REQUIRED",
      message: "An authenticated browser session is required",
    });
  });

  it("returns a fixed safe evidence download", async () => {
    let forwarded: RequestInit | undefined;
    const origin = await start((async (_input, init) => {
      forwarded = init;
      return new Response("Persisted evidence", {
      status: 200,
      headers: {"Content-Type": "text/plain; charset=UTF-8"},
      });
    }) as typeof fetch);

    const response = await fetch(`${origin}/api/v1/reports/evidence.txt`, {
      headers: {Cookie: `jsc-access-local=${TOKEN}`},
    });

    expect(response.status).toBe(200);
    expect(forwarded?.headers).toEqual({
      Accept: "text/plain",
      Authorization: `Bearer ${TOKEN}`,
    });
    expect(response.headers.get("content-disposition")).toBe("attachment; filename=job-search-evidence.txt");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("Persisted evidence");
  });

  it("keeps body consumption bounded and preserves the reporting unavailable contract", async () => {
    let capturedSignal: AbortSignal | undefined;
    const downstreamResponse = new Response(null, {
      status: 200,
      headers: {"Content-Type": "application/json"},
    });
    const downstreamText = vi.spyOn(downstreamResponse, "text").mockImplementation(
      () => new Promise<string>(() => undefined),
    );
    const origin = await start((async (_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return downstreamResponse;
    }) as typeof fetch, 5);

    const response = await fetch(`${origin}/api/v1/reports/summary`, {
      headers: {Cookie: `jsc-access-local=${TOKEN}`},
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "REPORTING_UNAVAILABLE",
      message: "Reporting is currently unavailable",
    });
    expect(downstreamText).toHaveBeenCalledOnce();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("fails closed when a downstream response leaks the session token", async () => {
    const origin = await start((async () => new Response(JSON.stringify({token: TOKEN}), {
      status: 200,
      headers: {"Content-Type": "application/json"},
    })) as typeof fetch);

    const response = await fetch(`${origin}/api/v1/reports/summary`, {
      headers: {Cookie: `jsc-access-local=${TOKEN}`},
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "INVALID_DOWNSTREAM_RESPONSE",
      message: "Reporting returned an invalid response",
    });
  });
});
