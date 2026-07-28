import type {Express, Request, Response} from "express";
import {fetchWithTimeout} from "./bff-boundary";
import {jobFinderCredentials} from "./job-finder-proxy";

export interface ReportingProxyConfig {
  accessCookieName: string;
  csrfCookieName: string;
  origin: string;
  timeoutMs: number;
}

const MAX_REPORT_BYTES = 1_048_576;
const REPORT_PATHS = new Set([
  "/api/v1/reports/summary",
  "/api/v1/reports/uc-journal",
  "/api/v1/reports/evidence.txt",
]);

function failure(response: Response, status: number, error: string, message: string): void {
  response.status(status).setHeader("Cache-Control", "private, no-store").json({error, message});
}

async function proxyReport(
  request: Request,
  response: Response,
  config: ReportingProxyConfig,
  path: string,
  fetchImplementation: typeof fetch,
): Promise<void> {
  if (!REPORT_PATHS.has(path)) {
    failure(response, 404, "REPORT_NOT_FOUND", "Reporting resource not found");
    return;
  }

  const credentials = jobFinderCredentials(request.headers, config, false, false);
  if ("error" in credentials) {
    failure(response, credentials.status, credentials.error, credentials.message);
    return;
  }

  const expectedText = path.endsWith(".txt");
  credentials.headers["Accept"] = expectedText ? "text/plain" : "application/json";

  try {
    const downstream = await fetchWithTimeout(
      `${config.origin}${path}`,
      {method: "GET", headers: credentials.headers},
      config.timeoutMs,
      fetchImplementation,
    );
    const body = await downstream.text();
    const accessToken = credentials.headers["Authorization"].slice("Bearer ".length);
    if (Buffer.byteLength(body) > MAX_REPORT_BYTES || body.includes(accessToken)) {
      failure(response, 502, "INVALID_DOWNSTREAM_RESPONSE", "Reporting returned an invalid response");
      return;
    }

    const contentType = downstream.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    const validContentType = expectedText
      ? contentType === "text/plain"
      : contentType === "application/json" || contentType === "application/problem+json";
    if (!validContentType) {
      failure(response, 502, "INVALID_DOWNSTREAM_RESPONSE", "Reporting returned an invalid response");
      return;
    }

    response.status(downstream.status);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.type(expectedText ? "text/plain" : contentType || "application/json");
    if (expectedText && downstream.ok) {
      response.setHeader("Content-Disposition", "attachment; filename=job-search-evidence.txt");
    }
    response.send(body);
  } catch {
    failure(response, 503, "REPORTING_UNAVAILABLE", "Reporting is currently unavailable");
  }
}

export function registerReportingRoutes(
  app: Express,
  config: ReportingProxyConfig,
  fetchImplementation: typeof fetch = fetch,
): void {
  for (const path of REPORT_PATHS) {
    app.get(path, (request, response) => {
      void proxyReport(request, response, config, path, fetchImplementation);
    });
  }
}
