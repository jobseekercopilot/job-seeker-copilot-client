import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { LocationGateway } from './app/gateways/location-gateway';
import {
  UNAVAILABLE_API_PREFIXES,
  rejectUnavailableCapability,
} from './server/unavailable-capabilities';
import {
  downstreamFailureResponse,
  jsonBodyErrorHandler,
  loadBffConfig,
  passwordResetIpRateLimiter,
  securityHeaders,
} from './server/bff-boundary';
import {callUserManagement} from './server/user-management-proxy';
import {registerUserManagementEvidenceRoutes} from './server/user-management-evidence-routes';
import {installGracefulShutdown} from './server/graceful-shutdown';
import {registerJobFinderRoutes} from './server/job-finder-proxy';
import {registerDocumentGenerationRoutes} from './server/document-generation-proxy';
import {registerReportingRoutes} from './server/reporting-proxy';
import {
  documentGenerationMode,
  jobSearchProviderMode,
} from './server/runtime-configuration';
import {
  setAppShellCacheHeaders,
  setStaticAssetCacheHeaders,
} from './server/static-cache-policy';

const browserDistFolder = join(import.meta.dirname, '../browser');
const bffConfig = loadBffConfig();

const app = express();
app.disable('x-powered-by');
if (bffConfig.trustedProxyHops > 0) {
  app.set('trust proxy', bffConfig.trustedProxyHops);
}
app.use(securityHeaders);
app.use(express.json({limit: bffConfig.jsonBodyLimitBytes}));
app.use(jsonBodyErrorHandler);

const locationGateway = new LocationGateway(bffConfig.downstreamTimeoutMs);

// User management gateway URL - configurable via environment variable
const USER_MANAGEMENT_GATEWAY_URL = bffConfig.userManagementGatewayOrigin;

const DOCUMENT_GENERATION_GATEWAY_URL = process.env['DOCUMENT_GENERATION_GATEWAY_URL'] || 'http://localhost:8092';

const DOCUMENT_STORE_SERVICE_URL = process.env['DOCUMENT_STORE_SERVICE_URL'] || 'http://localhost:8089';

const angularApp = new AngularNodeAppEngine({ allowedHosts: bffConfig.allowedHosts });
const PUBLIC_ACCOUNT_ROUTES: string[] = [
  '/register',
  '/sign-in',
  '/forgot-password',
  '/reset-password',
];

app.get('/api/runtime/job-search-mode', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({mode: jobSearchProviderMode()});
});

app.get('/api/runtime/document-generation-mode', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({mode: documentGenerationMode()});
});

app.get('/api/auth/csrf', async (req, res) => {
  await proxyUserManagementRequest('/api/auth/csrf', 'GET', req, res, true);
});

app.post('/api/auth/register', async (req, res) => {
  await proxyUserManagementRequest('/api/auth/register', 'POST', req, res, true);
});

/**
 * API Route: Login Claimant (User Management Gateway Verification)
 */
app.post('/api/auth/login', async (req, res) => {
  await proxyUserManagementRequest('/api/auth/login', 'POST', req, res, true);
});

const resetRequestIpLimiter = passwordResetIpRateLimiter(
  bffConfig.passwordResetRateLimitWindowMs,
  bffConfig.passwordResetRateLimitMaximum,
);

app.post('/api/auth/password-reset/request', resetRequestIpLimiter, async (req, res) => {
  await proxyUserManagementRequest(
    '/api/auth/password-reset/request',
    'POST',
    req,
    res,
    true,
  );
});

app.post('/api/auth/password-reset/complete', async (req, res) => {
  await proxyUserManagementRequest(
    '/api/auth/password-reset/complete',
    'POST',
    req,
    res,
    true,
  );
});

/**
 * API Route: Get Claimant Profile (User Management Gateway)
 */
app.get('/api/auth/profile', async (req, res) => {
  await proxyUserManagementRequest('/api/auth/profile', 'GET', req, res);
});

/**
 * API Route: Update Claimant Profile (User Management Gateway)
 * Ownership is derived only from the HttpOnly session cookie.
 */
app.put('/api/auth/profile', async (req, res) => {
  await proxyUserManagementRequest('/api/auth/profile', 'PUT', req, res);
});

app.patch('/api/auth/profile', async (req, res) => {
  await proxyUserManagementRequest('/api/auth/profile', 'PATCH', req, res);
});

app.post('/api/auth/refresh', async (req, res) => {
  await proxyUserManagementRequest('/api/auth/refresh', 'POST', req, res, true);
});

app.post('/api/auth/logout', async (req, res) => {
  await proxyUserManagementRequest('/api/auth/logout', 'POST', req, res, true);
});

registerUserManagementEvidenceRoutes(app, {
  origin: USER_MANAGEMENT_GATEWAY_URL,
  timeoutMs: bffConfig.downstreamTimeoutMs,
});

async function proxyUserManagementRequest(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  req: express.Request,
  res: express.Response,
  forwardSessionCookies = false,
): Promise<void> {
  try {
    const result = await callUserManagement(
      USER_MANAGEMENT_GATEWAY_URL,
      path,
      method,
      req.headers,
      req.body,
      bffConfig.downstreamTimeoutMs,
    );

    if (forwardSessionCookies && result.setCookies.length) {
      res.setHeader('Set-Cookie', result.setCookies);
    }
    res.setHeader('Cache-Control', result.cacheControl);
    res.status(result.status).type(result.contentType).send(result.body);
  } catch (error: unknown) {
    const failure = downstreamFailureResponse(error);
    console.error('BFF downstream request failed', {service: 'user-management', category: failure.category});
    res.status(failure.statusCode).json({
      statusCode: failure.statusCode,
      success: false,
      message: failure.message,
    });
  }
}

/**
 * API Route: Search/Autocomplete UK Locations (Location Gateway)
 */
app.get('/api/locations', async (req, res) => {
  const query = req.query['q'] as string;
  if (query === undefined) {
    res.status(400).json({
      statusCode: 400,
      success: false,
      message: "Missing search query parameter. 'q' must be provided."
    });
    return;
  }
  const result = await locationGateway.handleSearch(query);
  res.status(result.statusCode).json(result);
});

/**
 * API Route: Get location by postcode (Location Gateway)
 */
app.get('/api/postcodes/:postcode', async (req, res) => {
  const postcode = req.params.postcode;
  if (!postcode) {
    res.status(400).json({
      statusCode: 400,
      success: false,
      message: "Missing postcode parameter."
    });
    return;
  }
  const result = await locationGateway.handlePostcode(postcode);
  res.status(result.statusCode).json(result);
});

app.post('/api/v2/locations/autocomplete', async (req, res) => {
  const result = await locationGateway.handleAutocomplete(req.body);
  res.setHeader('Cache-Control', 'no-store');
  res.status(result.statusCode).type(result.contentType).send(result.body);
});

app.post('/api/v2/locations/resolve', async (req, res) => {
  const result = await locationGateway.handleResolve(req.body);
  res.setHeader('Cache-Control', 'no-store');
  res.status(result.statusCode).type(result.contentType).send(result.body);
});

registerJobFinderRoutes(app, {
  accessCookieName: bffConfig.sessionAccessCookieName,
  csrfCookieName: bffConfig.sessionCsrfCookieName,
  origin: bffConfig.jobFinderGatewayOrigin,
  timeoutMs: bffConfig.downstreamTimeoutMs,
});
registerDocumentGenerationRoutes(app, {
  accessCookieName: bffConfig.sessionAccessCookieName,
  csrfCookieName: bffConfig.sessionCsrfCookieName,
  origin: DOCUMENT_GENERATION_GATEWAY_URL,
  documentStoreOrigin: DOCUMENT_STORE_SERVICE_URL,
  timeoutMs: Math.max(bffConfig.downstreamTimeoutMs, 60_000),
});

registerReportingRoutes(app, {
  accessCookieName: bffConfig.sessionAccessCookieName,
  csrfCookieName: bffConfig.sessionCsrfCookieName,
  origin: bffConfig.reportingGatewayOrigin,
  timeoutMs: bffConfig.downstreamTimeoutMs,
});

// Payments remain fail-closed until its BFF integration derives identity from
// the HttpOnly session and enforces CSRF for mutations.
app.use(UNAVAILABLE_API_PREFIXES, rejectUnavailableCapability);

app.use((req, res, next) => {
  setAppShellCacheHeaders(res, req.method, req.path);
  next();
});

app.get(PUBLIC_ACCOUNT_ROUTES, (req, res, next) => {
  const routeDirectory = req.path.slice(1);
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(join(browserDistFolder, routeDirectory, 'index.html'), (error) => {
    if (error) next(error);
  });
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
    setHeaders: setStaticAssetCacheHeaders,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 3000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const server = app.listen(bffConfig.port, bffConfig.host, () => {
    console.log(`Node Express server listening on ${bffConfig.host}:${bffConfig.port}`);
  });
  server.requestTimeout = bffConfig.requestTimeoutMs;
  server.headersTimeout = bffConfig.headersTimeoutMs;
  server.keepAliveTimeout = bffConfig.keepAliveTimeoutMs;
  installGracefulShutdown(server);
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
