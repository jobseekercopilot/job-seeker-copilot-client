import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { LocationGateway } from './app/gateways/location-gateway';
import {upstreamSetCookies, userManagementHeaders} from './server/user-management-proxy';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
app.use(express.json());

const locationGateway = new LocationGateway();

// User management gateway URL - configurable via environment variable
const USER_MANAGEMENT_GATEWAY_URL = process.env['USER_MANAGEMENT_GATEWAY_URL'] || 'http://localhost:8083';

// Job finder gateway URL - configurable via environment variable
const JOB_FINDER_GATEWAY_URL = process.env['JOB_FINDER_GATEWAY_URL'] || 'http://localhost:8080';

const DOCUMENT_GENERATION_GATEWAY_URL = process.env['DOCUMENT_GENERATION_GATEWAY_URL'] || 'http://localhost:8092';

const DOCUMENT_STORE_SERVICE_URL = process.env['DOCUMENT_STORE_SERVICE_URL'] || 'http://localhost:8089';

const REPORTING_GATEWAY_URL = process.env['REPORTING_GATEWAY_URL'] || 'http://localhost:8095';

const PAYMENT_GATEWAY_URL = process.env['PAYMENT_GATEWAY_URL'] || 'http://localhost:8098';

const allowedHosts = (process.env['NG_ALLOWED_HOSTS'] || 'localhost,127.0.0.1,job-seeker-copilot-client')
  .split(',')
  .map(host => host.trim())
  .filter(Boolean);

const angularApp = new AngularNodeAppEngine({ allowedHosts });

app.get('/api/auth/csrf', async (req, res) => {
  await proxyUserManagementRequest('/api/auth/csrf', 'GET', req, res);
});

app.post('/api/auth/register', async (req, res) => {
  await proxyUserManagementRequest('/api/auth/register', 'POST', req, res);
});

/**
 * API Route: Login Claimant (User Management Gateway Verification)
 */
app.post('/api/auth/login', async (req, res) => {
  await proxyUserManagementRequest('/api/auth/login', 'POST', req, res);
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

app.post('/api/auth/refresh', async (req, res) => {
  await proxyUserManagementRequest('/api/auth/refresh', 'POST', req, res);
});

app.post('/api/auth/logout', async (req, res) => {
  await proxyUserManagementRequest('/api/auth/logout', 'POST', req, res);
});

async function proxyUserManagementRequest(
  path: string,
  method: 'GET' | 'POST' | 'PUT',
  req: express.Request,
  res: express.Response
): Promise<void> {
  try {
    const hasBody = method !== 'GET';
    const headers = userManagementHeaders(req.headers, hasBody);

    const response = await fetch(`${USER_MANAGEMENT_GATEWAY_URL}${path}`, {
      method,
      headers,
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined
    });

    const setCookies = upstreamSetCookies(response.headers);
    if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
    res.setHeader('Cache-Control', response.headers.get('cache-control') || 'no-store');
    const data = await response.text();
    const contentType = response.headers.get('content-type') || 'application/json';
    res.status(response.status).type(contentType).send(data);
  } catch (error: unknown) {
    console.error('User management proxy error:', error);
    res.status(503).json({
      statusCode: 503,
      success: false,
      message: 'User management service is currently unavailable'
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

// These capabilities have no authoritative private contract in the selected
// User Management beta. Register the fail-closed boundary before their retained
// legacy proxy handlers so they cannot be reached accidentally.
app.use([
  '/api/jobs',
  '/api/v1/applications',
  '/api/v1/document-generation',
  '/api/v1/documents',
  '/api/v1/reports',
], (_req, res) => {
  res.status(404).json({
    error: 'FEATURE_NOT_AVAILABLE',
    message: 'This capability is not available in the User Management beta',
  });
});

/**
 * API Route: Search Jobs via Job Finder Gateway
 * Proxies POST requests from the Angular frontend to the Java job-finder-gateway.
 * Forwards the Authorization header (JWT Bearer token) for authentication.
 */
app.post('/api/jobs/search', async (req, res) => {
  try {
    const token = req.headers['authorization'] as string;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (token) headers['Authorization'] = token;
    const userId = req.headers['x-user-id'];
    if (typeof userId === 'string') headers['X-User-Id'] = userId;

    const response = await fetch(`${JOB_FINDER_GATEWAY_URL}/api/jobs/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
    });

    const data = await response.text();
    res.status(response.status).send(data);
  } catch (error: unknown) {
    console.error('Job search proxy error:', error);
    res.status(503).json({
      error: 'SERVICE_UNAVAILABLE',
      message: 'Job search service is currently unavailable',
    });
  }
});

app.get('/api/jobs/applications/user/:userId', async (req, res) => {
  await proxyJobFinderRequest(
    `/api/jobs/applications/user/${encodeURIComponent(req.params.userId)}`,
    'GET',
    req,
    res
  );
});

app.get('/api/v1/applications/user/:userId', async (req, res) => {
  await proxyJobFinderRequest(
    `/api/jobs/applications/user/${encodeURIComponent(req.params.userId)}`,
    'GET',
    req,
    res
  );
});

app.patch('/api/jobs/applications/:applicationId/status', async (req, res) => {
  await proxyJobFinderRequest(
    `/api/jobs/applications/${encodeURIComponent(req.params.applicationId)}/status`,
    'PATCH',
    req,
    res
  );
});

app.post('/api/jobs/applications/:applicationId/withdraw-generated', async (req, res) => {
  await proxyJobFinderRequest(
    `/api/jobs/applications/${encodeURIComponent(req.params.applicationId)}/withdraw-generated`,
    'POST',
    req,
    res
  );
});

async function proxyJobFinderRequest(
  path: string,
  method: 'GET' | 'POST' | 'PATCH',
  req: express.Request,
  res: express.Response
): Promise<void> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const authorization = req.headers['authorization'];
    if (typeof authorization === 'string') headers['Authorization'] = authorization;
    const userId = req.headers['x-user-id'];
    if (typeof userId === 'string') headers['X-User-Id'] = userId;

    const response = await fetch(`${JOB_FINDER_GATEWAY_URL}${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(req.body ?? {}),
    });

    const data = await response.text();
    res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(data);
  } catch (error: unknown) {
    console.error('Job finder proxy error:', error);
    res.status(503).json({
      error: 'SERVICE_UNAVAILABLE',
      message: 'Job finder service is currently unavailable',
    });
  }
}

app.post('/api/v1/document-generation/jobs/:jobId/generate', async (req, res) => {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const authorization = req.headers['authorization'];
    if (typeof authorization === 'string') headers['Authorization'] = authorization;
    const userId = req.headers['x-user-id'];
    if (typeof userId === 'string') headers['X-User-Id'] = userId;

    const response = await fetch(
      `${DOCUMENT_GENERATION_GATEWAY_URL}/api/v1/document-generation/jobs/${encodeURIComponent(req.params.jobId)}/generate`,
      { method: 'POST', headers, body: JSON.stringify(req.body) }
    );
    const data = await response.text();
    res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(data);
  } catch (error: unknown) {
    console.error('Document generation proxy error:', error);
    res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'Document generation is unavailable' });
  }
});

app.post('/api/v1/document-generation/documents/:generatedDocumentId/upload', async (req, res) => {
  await proxyDocumentMultipartRequest(
    `/api/v1/document-generation/documents/${encodeURIComponent(req.params.generatedDocumentId)}/upload`,
    'Document upload proxy error:',
    req,
    res
  );
});

app.post('/api/v1/document-generation/applications/:applicationId/replace', async (req, res) => {
  await proxyDocumentMultipartRequest(
    `/api/v1/document-generation/applications/${encodeURIComponent(req.params.applicationId)}/replace`,
    'Document replacement proxy error:',
    req,
    res
  );
});

async function proxyDocumentMultipartRequest(
  path: string,
  logMessage: string,
  req: express.Request,
  res: express.Response
): Promise<void> {
  try {
    const headers: Record<string, string> = {};
    const authorization = req.headers['authorization'];
    if (typeof authorization === 'string') headers['Authorization'] = authorization;
    const contentType = req.headers['content-type'];
    if (typeof contentType === 'string') headers['Content-Type'] = contentType;
    const contentLength = req.headers['content-length'];
    if (typeof contentLength === 'string') headers['Content-Length'] = contentLength;
    const userId = req.headers['x-user-id'];
    if (typeof userId === 'string') headers['X-User-Id'] = userId;

    const uploadRequest = {
      method: 'POST',
      headers,
      body: req,
      duplex: 'half',
    } as unknown as RequestInit & { duplex: 'half' };

    const response = await fetch(`${DOCUMENT_GENERATION_GATEWAY_URL}${path}`, uploadRequest);
    const data = await response.text();
    res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(data);
  } catch (error: unknown) {
    console.error(logMessage, error);
    res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'Document upload is unavailable' });
  }
}

app.get('/api/v1/document-generation/files/:fileId/download', async (req, res) => {
  try {
    const headers: Record<string, string> = {};
    const authorization = req.headers['authorization'];
    if (typeof authorization === 'string') headers['Authorization'] = authorization;

    const response = await fetch(
      `${DOCUMENT_GENERATION_GATEWAY_URL}/api/v1/document-generation/files/${encodeURIComponent(req.params.fileId)}/download`,
      { method: 'GET', headers }
    );
    const data = Buffer.from(await response.arrayBuffer());

    const contentType = response.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    const contentDisposition = response.headers.get('content-disposition');
    if (contentDisposition) res.setHeader('Content-Disposition', contentDisposition);
    const contentLength = response.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    res.status(response.status).send(data);
  } catch (error: unknown) {
    console.error('Document download proxy error:', error);
    res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'Document download is unavailable' });
  }
});

app.get('/api/v1/documents/:generatedDocumentId/files/latest', async (req, res) => {
  await proxyDocumentStoreRequest(
    `/api/v1/documents/${encodeURIComponent(req.params.generatedDocumentId)}/files/latest`,
    'GET',
    'Document latest file metadata proxy error:',
    req,
    res
  );
});

app.get('/api/v1/documents/:generatedDocumentId/files', async (req, res) => {
  await proxyDocumentStoreRequest(
    `/api/v1/documents/${encodeURIComponent(req.params.generatedDocumentId)}/files`,
    'GET',
    'Document file metadata proxy error:',
    req,
    res
  );
});

app.delete('/api/v1/documents/:generatedDocumentId', async (req, res) => {
  await proxyDocumentStoreRequest(
    `/api/v1/documents/${encodeURIComponent(req.params.generatedDocumentId)}`,
    'DELETE',
    'Document delete proxy error:',
    req,
    res
  );
});

async function proxyDocumentStoreRequest(
  path: string,
  method: 'GET' | 'DELETE',
  logMessage: string,
  req: express.Request,
  res: express.Response
): Promise<void> {
  try {
    const headers: Record<string, string> = {};
    const authorization = req.headers['authorization'];
    if (typeof authorization === 'string') headers['Authorization'] = authorization;

    const response = await fetch(`${DOCUMENT_STORE_SERVICE_URL}${path}`, { method, headers });
    if (response.status === 204) {
      res.status(204).send();
      return;
    }

    const data = await response.text();
    res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(data);
  } catch (error: unknown) {
    console.error(logMessage, error);
    res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'Document store is unavailable' });
  }
}

app.get('/api/v1/document-generation/documents/:generatedDocumentId/files/latest', async (req, res) => {
  try {
    const response = await fetch(
      `${DOCUMENT_STORE_SERVICE_URL}/api/v1/documents/${encodeURIComponent(req.params.generatedDocumentId)}/files/latest`,
      { method: 'GET' }
    );
    const data = await response.text();
    if (!response.ok) {
      res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(data);
      return;
    }

    const files = JSON.parse(data) as { id?: string; fileType?: string; fileName?: string }[];
    const toDownload = (file: { id?: string; fileName?: string } | undefined) => file?.id ? {
      fileId: file.id,
      downloadUrl: `/api/v1/document-generation/files/${file.id}/download`,
      fileName: file.fileName,
    } : undefined;

    const docx = files.find(file => file.fileType === 'DOCX');
    const pdf = files.find(file => file.fileType === 'PDF');
    res.status(200).json({ docx: toDownload(docx), pdf: toDownload(pdf) });
  } catch (error: unknown) {
    console.error('Document latest-files proxy error:', error);
    res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'Document files are unavailable' });
  }
});

app.get('/api/v1/reports/:reportName', async (req, res) => {
  try {
    const headers: Record<string, string> = {};
    const userId = req.headers['x-user-id'];
    if (typeof userId === 'string' && userId.trim()) {
      headers['X-User-Id'] = userId;
    }
    const authorization = req.headers['authorization'];
    if (typeof authorization === 'string') {
      headers['Authorization'] = authorization;
    }

    if (!headers['X-User-Id'] && headers['Authorization']) {
      const restoredUserId = await restoreUserId(headers['Authorization']);
      if (restoredUserId) {
        headers['X-User-Id'] = restoredUserId;
      }
    }

    const response = await fetch(
      `${REPORTING_GATEWAY_URL}/api/v1/reports/${encodeURIComponent(req.params.reportName)}`,
      { method: 'GET', headers }
    );
    const data = await response.text();
    res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(data);
  } catch (error: unknown) {
    console.error('Reporting proxy error:', error);
    res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'Reporting is unavailable' });
  }
});

app.get('/api/v1/payment/wallet', async (req, res) => {
  await proxyPaymentGatewayRequest('/api/v1/payment/wallet', 'GET', req, res);
});

app.get('/api/v1/payment/transactions', async (req, res) => {
  const limit = typeof req.query['limit'] === 'string' ? req.query['limit'] : '20';
  const searchParams = new URLSearchParams({ limit });
  await proxyPaymentGatewayRequest(`/api/v1/payment/transactions?${searchParams.toString()}`, 'GET', req, res);
});

app.get('/api/v1/payment/pricing', async (req, res) => {
  await proxyPaymentGatewayRequest('/api/v1/payment/pricing', 'GET', req, res);
});

app.post('/api/v1/payment/demo-purchase', async (req, res) => {
  await proxyPaymentGatewayRequest('/api/v1/payment/demo-purchase', 'POST', req, res);
});

app.post('/api/v1/payment/checkout', async (req, res) => {
  await proxyPaymentGatewayRequest('/api/v1/payment/checkout', 'POST', req, res);
});

async function proxyPaymentGatewayRequest(
  path: string,
  method: 'GET' | 'POST',
  req: express.Request,
  res: express.Response
): Promise<void> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const authorization = req.headers['authorization'];
    if (typeof authorization === 'string') headers['Authorization'] = authorization;
    const userId = req.headers['x-user-id'];
    if (typeof userId === 'string') headers['X-User-Id'] = userId;

    const response = await fetch(`${PAYMENT_GATEWAY_URL}${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(req.body ?? {}),
    });

    const data = await response.text();
    res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(data);
  } catch (error: unknown) {
    console.error('Payment gateway proxy error:', error);
    res.status(503).json({
      error: 'SERVICE_UNAVAILABLE',
      message: 'Payment service is currently unavailable',
    });
  }
}

async function restoreUserId(authorization: string): Promise<string | null> {
  try {
    const response = await fetch(`${USER_MANAGEMENT_GATEWAY_URL}/api/auth/profile`, {
      method: 'GET',
      headers: { Authorization: authorization },
    });
    if (!response.ok) return null;

    const body = await response.json() as { success?: boolean; user?: { id?: string } };
    return body.success && body.user?.id ? body.user.id : null;
  } catch (error: unknown) {
    console.warn('Unable to restore user id for reporting:', error);
    return null;
  }
}

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
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
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = Number(process.env['PORT'] || 3000);
  const host = process.env['HOST'] || '0.0.0.0';
  app.listen(port, host, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://${host}:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
