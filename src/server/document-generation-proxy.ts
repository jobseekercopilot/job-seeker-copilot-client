import type {Express, Request, Response} from 'express';
import {
  downstreamFailureCategory,
  fetchWithTimeout,
} from './bff-boundary';
import {
  jobFinderCredentials,
  type JobFinderProxyConfig,
} from './job-finder-proxy';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_DOWNLOAD_TYPES = new Set([
  'application/octet-stream',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const DOCUMENT_TYPES = new Set(['CV', 'COVER_LETTER']);
const EVIDENCE_SECTIONS = new Set([
  'EMPLOYMENT',
  'EDUCATION',
  'QUALIFICATION_TRAINING',
  'PROJECT',
  'VOLUNTEERING',
  'FREELANCE',
  'ACHIEVEMENT',
  'CAREER_BREAK',
  'OTHER',
]);
const MAX_MULTIPART_BYTES = (25 * 1024 * 1024) + (64 * 1024);
const MULTIPART_CONTENT_TYPE =
  /^multipart\/form-data;\s*boundary=(?:"[^"\r\n;]{1,200}"|[^\s\r\n;]{1,200})$/i;

export interface DocumentGenerationProxyConfig extends JobFinderProxyConfig {
  documentStoreOrigin: string;
}

class RequestTooLargeError extends Error {
  override readonly name = 'RequestTooLargeError';
}

interface ProxyPayload {
  body: string;
  contentType: string;
  status: number;
}

function validUuid(value: string): boolean {
  return UUID.test(value);
}

interface DocumentEvidenceSelectionBody {
  purpose: 'CV' | 'COVER_LETTER';
  entryIds: string[];
  sectionOrder: string[];
}

interface StartGenerationBody {
  documents: DocumentEvidenceSelectionBody[];
}

function exactObjectKeys(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function startGenerationBody(value: unknown): StartGenerationBody | undefined {
  if (!exactObjectKeys(value, ['documents']) || !Array.isArray(value['documents'])) {
    return undefined;
  }
  if (value['documents'].length !== 2) return undefined;

  const expectedPurposes = ['CV', 'COVER_LETTER'] as const;
  const documents: DocumentEvidenceSelectionBody[] = [];
  for (const [index, candidate] of value['documents'].entries()) {
    if (!exactObjectKeys(candidate, ['purpose', 'entryIds', 'sectionOrder'])) {
      return undefined;
    }
    const purpose = candidate['purpose'];
    const entryIds = candidate['entryIds'];
    const sectionOrder = candidate['sectionOrder'];
    if (
      purpose !== expectedPurposes[index]
      || !Array.isArray(entryIds)
      || entryIds.length < 1
      || entryIds.length > 50
      || !entryIds.every(entryId => typeof entryId === 'string' && validUuid(entryId))
      || new Set(entryIds.map(entryId => entryId.toLowerCase())).size !== entryIds.length
      || !Array.isArray(sectionOrder)
      || sectionOrder.length < 1
      || sectionOrder.length > EVIDENCE_SECTIONS.size
      || !sectionOrder.every(section =>
        typeof section === 'string' && EVIDENCE_SECTIONS.has(section))
      || new Set(sectionOrder).size !== sectionOrder.length
    ) {
      return undefined;
    }
    documents.push({
      purpose: purpose as 'CV' | 'COVER_LETTER',
      entryIds: entryIds.map(entryId => entryId.toLowerCase()),
      sectionOrder: [...sectionOrder] as string[],
    });
  }
  return {documents};
}

function sendFailure(
  response: Response,
  status: number,
  error: string,
  message: string,
): void {
  response
    .status(status)
    .setHeader('Cache-Control', 'private, no-store')
    .json({error, message});
}

async function callJson(
  config: DocumentGenerationProxyConfig,
  origin: string,
  path: string,
  request: Request,
  method: 'GET' | 'POST',
  requiresCsrf: boolean,
  fetchImplementation: typeof fetch,
  additionalHeaders: Record<string, string> = {},
): Promise<ProxyPayload | undefined> {
  const credentials = jobFinderCredentials(
    request.headers,
    config,
    requiresCsrf,
    method === 'POST',
  );
  if ('status' in credentials) return {
    body: JSON.stringify({
      error: credentials.error,
      message: credentials.message,
    }),
    contentType: 'application/json',
    status: credentials.status,
  };

  const response = await fetchWithTimeout(
    `${origin}${path}`,
    {
      method,
      headers: {...credentials.headers, ...additionalHeaders},
      body: method === 'POST' ? JSON.stringify(request.body) : undefined,
    },
    config.timeoutMs,
    fetchImplementation,
  );
  const body = await response.text();
  const accessToken = credentials.headers['Authorization'].slice('Bearer '.length);
  if (body.includes(accessToken)) return undefined;

  const upstreamType = response.headers
    .get('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase();
  return {
    body,
    contentType: upstreamType === 'application/problem+json'
      ? 'application/problem+json'
      : 'application/json',
    status: response.status,
  };
}

function sendPayload(response: Response, payload: ProxyPayload | undefined): void {
  response.setHeader('Cache-Control', 'private, no-store');
  if (!payload) {
    sendFailure(
      response,
      502,
      'INVALID_DOWNSTREAM_RESPONSE',
      'The document service returned an invalid response',
    );
    return;
  }
  response.status(payload.status).type(payload.contentType).send(payload.body);
}

function multipartType(request: Request): string | undefined {
  const contentType = request.get('Content-Type')?.trim();
  return contentType
    && contentType.length <= 256
    && MULTIPART_CONTENT_TYPE.test(contentType)
    ? contentType
    : undefined;
}

async function boundedRequestBody(
  request: Request,
  maximumBytes: number,
): Promise<Buffer> {
  const declaredLength = request.get('Content-Length');
  if (
    declaredLength
    && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw new RequestTooLargeError('Upload exceeds the allowed size');
  }

  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.length;
    if (receivedBytes > maximumBytes) {
      throw new RequestTooLargeError('Upload exceeds the allowed size');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, receivedBytes);
}

function safeFileName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalised = [...value.trim()]
    .filter(character => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127;
    })
    .join('');
  return normalised && normalised.length <= 255 ? normalised : undefined;
}

function downloadMetadata(value: unknown): {
  fileId: string;
  downloadUrl: string;
  fileName?: string;
} | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const file = value as {id?: unknown; fileName?: unknown};
  if (typeof file.id !== 'string' || !validUuid(file.id)) return undefined;
  return {
    fileId: file.id.toLowerCase(),
    downloadUrl: `/api/v1/document-generation/files/${file.id.toLowerCase()}/download`,
    fileName: safeFileName(file.fileName),
  };
}

export function registerDocumentGenerationRoutes(
  app: Express,
  config: DocumentGenerationProxyConfig,
  fetchImplementation: typeof fetch = fetch,
): void {
  const proxyJson = async (
    request: Request,
    response: Response,
    origin: string,
    path: string,
    method: 'GET' | 'POST',
    requiresCsrf: boolean,
    additionalHeaders: Record<string, string> = {},
  ): Promise<void> => {
    try {
      sendPayload(
        response,
        await callJson(
          config,
          origin,
          path,
          request,
          method,
          requiresCsrf,
          fetchImplementation,
          additionalHeaders,
        ),
      );
    } catch (error: unknown) {
      const category = downstreamFailureCategory(error);
      console.error('BFF downstream request failed', {
        category,
        service: 'document-generation',
      });
      sendFailure(
        response,
        category === 'timeout' ? 504 : 503,
        category === 'timeout' ? 'DOWNSTREAM_TIMEOUT' : 'SERVICE_UNAVAILABLE',
        category === 'timeout'
          ? 'Document generation timed out'
          : 'Document generation is currently unavailable',
      );
    }
  };

  app.post('/api/v1/document-generation/saved-jobs/:savedJobId/operations', async (request, response) => {
    const savedJobId = request.params['savedJobId'];
    const idempotencyKey = request.get('Idempotency-Key')?.trim();
    if (!validUuid(savedJobId)) {
      sendFailure(response, 400, 'INVALID_SAVED_JOB_ID', 'The saved job identifier is invalid');
      return;
    }
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      sendFailure(response, 400, 'INVALID_IDEMPOTENCY_KEY', 'A valid idempotency key is required');
      return;
    }
    const body = startGenerationBody(request.body);
    if (!body) {
      sendFailure(
        response,
        400,
        'INVALID_EVIDENCE_SELECTION',
        'Choose valid confirmed evidence separately for the CV and cover letter',
      );
      return;
    }
    request.body = body;
    await proxyJson(
      request,
      response,
      config.origin,
      `/api/v1/document-generation/saved-jobs/${savedJobId.toLowerCase()}/operations`,
      'POST',
      true,
      {'Idempotency-Key': idempotencyKey},
    );
  });

  app.post('/api/v1/document-generation/operations/:operationId/approve', async (request, response) => {
    const operationId = request.params['operationId'];
    if (!validUuid(operationId)) {
      sendFailure(response, 400, 'INVALID_OPERATION_ID', 'The generation operation identifier is invalid');
      return;
    }
    await proxyJson(
      request,
      response,
      config.origin,
      `/api/v1/document-generation/operations/${operationId.toLowerCase()}/approve`,
      'POST',
      true,
    );
  });

  app.post('/api/v1/document-generation/applications/:applicationId/replace', async (request, response) => {
    const applicationId = request.params['applicationId'];
    const documentType = request.query['documentType'];
    if (!validUuid(applicationId)) {
      sendFailure(
        response,
        400,
        'INVALID_APPLICATION_ID',
        'The application identifier is invalid',
      );
      return;
    }
    if (typeof documentType !== 'string' || !DOCUMENT_TYPES.has(documentType)) {
      sendFailure(
        response,
        400,
        'INVALID_DOCUMENT_TYPE',
        'The replacement document type is invalid',
      );
      return;
    }
    const contentType = multipartType(request);
    if (!contentType) {
      sendFailure(
        response,
        415,
        'INVALID_CONTENT_TYPE',
        'A multipart document upload is required',
      );
      return;
    }
    const credentials = jobFinderCredentials(
      request.headers,
      config,
      true,
      false,
    );
    if ('status' in credentials) {
      sendFailure(
        response,
        credentials.status,
        credentials.error,
        credentials.message,
      );
      return;
    }

    try {
      const body = await boundedRequestBody(request, MAX_MULTIPART_BYTES);
      const upstream = await fetchWithTimeout(
        `${config.origin}/api/v1/document-generation/applications/${applicationId.toLowerCase()}/replace?documentType=${documentType}`,
        {
          method: 'POST',
          headers: {
            ...credentials.headers,
            'Content-Length': String(body.length),
            'Content-Type': contentType,
          },
          body: Uint8Array.from(body).buffer,
        },
        config.timeoutMs,
        fetchImplementation,
      );
      const payload = await upstream.text();
      const accessToken = credentials.headers['Authorization'].slice('Bearer '.length);
      if (payload.includes(accessToken)) {
        sendPayload(response, undefined);
        return;
      }
      const upstreamType = upstream.headers
        .get('content-type')
        ?.split(';', 1)[0]
        .trim()
        .toLowerCase();
      sendPayload(response, {
        body: payload,
        contentType: upstreamType === 'application/problem+json'
          ? 'application/problem+json'
          : 'application/json',
        status: upstream.status,
      });
    } catch (error: unknown) {
      if (error instanceof RequestTooLargeError) {
        sendFailure(
          response,
          413,
          'REQUEST_TOO_LARGE',
          'The document upload exceeds the 25MB limit',
        );
        return;
      }
      const category = downstreamFailureCategory(error);
      console.error('BFF downstream request failed', {
        category,
        service: 'document-replacement',
      });
      sendFailure(
        response,
        category === 'timeout' ? 504 : 503,
        category === 'timeout' ? 'DOWNSTREAM_TIMEOUT' : 'SERVICE_UNAVAILABLE',
        category === 'timeout'
          ? 'Document replacement timed out'
          : 'Document replacement is currently unavailable',
      );
    }
  });

  app.get('/api/v1/document-generation/files/:fileId/download', async (request, response) => {
    const fileId = request.params['fileId'];
    if (!validUuid(fileId)) {
      sendFailure(response, 400, 'INVALID_FILE_ID', 'The document file identifier is invalid');
      return;
    }
    const credentials = jobFinderCredentials(request.headers, config, false, false);
    if ('status' in credentials) {
      sendFailure(response, credentials.status, credentials.error, credentials.message);
      return;
    }

    try {
      const upstream = await fetchWithTimeout(
        `${config.origin}/api/v1/document-generation/files/${fileId.toLowerCase()}/download`,
        {method: 'GET', headers: credentials.headers},
        config.timeoutMs,
        fetchImplementation,
      );
      response.setHeader('Cache-Control', 'private, no-store');
      const contentType = upstream.headers
        .get('content-type')
        ?.split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (!upstream.ok || !contentType || !SAFE_DOWNLOAD_TYPES.has(contentType)) {
        sendFailure(
          response,
          upstream.ok ? 502 : upstream.status,
          upstream.ok ? 'INVALID_DOWNSTREAM_RESPONSE' : 'DOCUMENT_DOWNLOAD_FAILED',
          upstream.ok
            ? 'The document service returned an invalid file'
            : 'The document could not be downloaded',
        );
        return;
      }

      const contentDisposition = upstream.headers.get('content-disposition');
      if (
        contentDisposition
        && contentDisposition.length <= 512
        && !/[\r\n]/.test(contentDisposition)
      ) {
        response.setHeader('Content-Disposition', contentDisposition);
      }
      response.status(200).type(contentType).send(
        Buffer.from(await upstream.arrayBuffer()),
      );
    } catch (error: unknown) {
      const category = downstreamFailureCategory(error);
      console.error('BFF downstream request failed', {
        category,
        service: 'document-download',
      });
      sendFailure(
        response,
        category === 'timeout' ? 504 : 503,
        category === 'timeout' ? 'DOWNSTREAM_TIMEOUT' : 'SERVICE_UNAVAILABLE',
        category === 'timeout'
          ? 'Document download timed out'
          : 'Document download is currently unavailable',
      );
    }
  });

  app.get('/api/v1/document-generation/documents/:generatedDocumentId/files/latest', async (request, response) => {
    const documentId = request.params['generatedDocumentId'];
    if (!validUuid(documentId)) {
      sendFailure(response, 400, 'INVALID_DOCUMENT_ID', 'The document identifier is invalid');
      return;
    }
    try {
      const payload = await callJson(
        config,
        config.documentStoreOrigin,
        `/api/v1/documents/${documentId.toLowerCase()}/files/latest`,
        request,
        'GET',
        false,
        fetchImplementation,
      );
      if (!payload || payload.status !== 200) {
        sendPayload(response, payload);
        return;
      }
      const files = JSON.parse(payload.body) as {
        fileType?: unknown;
        active?: unknown;
      }[];
      if (!Array.isArray(files)) {
        sendPayload(response, undefined);
        return;
      }
      const activeFiles = files.filter(file => file.active !== false);
      response
        .status(200)
        .setHeader('Cache-Control', 'private, no-store')
        .json({
          docx: downloadMetadata(
            activeFiles.find(file => file.fileType === 'DOCX'),
          ),
          pdf: downloadMetadata(
            activeFiles.find(file => file.fileType === 'PDF'),
          ),
        });
    } catch (error: unknown) {
      const category = downstreamFailureCategory(error);
      console.error('BFF downstream request failed', {
        category,
        service: 'document-metadata',
      });
      sendFailure(
        response,
        category === 'timeout' ? 504 : 503,
        category === 'timeout' ? 'DOWNSTREAM_TIMEOUT' : 'SERVICE_UNAVAILABLE',
        category === 'timeout'
          ? 'Document metadata timed out'
          : 'Document metadata is currently unavailable',
      );
    }
  });

  for (const suffix of ['files/latest', 'files']) {
    app.get(`/api/v1/documents/:generatedDocumentId/${suffix}`, async (request, response) => {
      const documentId = request.params['generatedDocumentId'];
      if (!validUuid(documentId)) {
        sendFailure(response, 400, 'INVALID_DOCUMENT_ID', 'The document identifier is invalid');
        return;
      }
      await proxyJson(
        request,
        response,
        config.documentStoreOrigin,
        `/api/v1/documents/${documentId.toLowerCase()}/${suffix}`,
        'GET',
        false,
      );
    });
  }
}
