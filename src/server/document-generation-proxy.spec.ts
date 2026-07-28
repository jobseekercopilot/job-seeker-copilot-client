import express from 'express';
import type {Server} from 'node:http';
import {
  type DocumentGenerationProxyConfig,
  registerDocumentGenerationRoutes,
} from './document-generation-proxy';

const ACCESS_TOKEN = 'a.a.a';
const CSRF_TOKEN = 'csrf-token-123';
const DOCUMENT_ID = '3b0f6a57-389d-4e20-a007-199afca04b20';
const FILE_ID = '9f40a536-4167-4b5c-9295-c41b6e127f84';
const OPERATION_ID = '69e794d1-f0aa-4ed5-9779-a5f3e98610cb';
const APPLICATION_ID = 'c17442dd-c24f-48a2-86e5-b0ec7f38f8cb';
const MULTIPART_TYPE = 'multipart/form-data; boundary=test-boundary';
const MULTIPART_BODY = '--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="Updated CV.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\nsafe-docx-test\r\n--test-boundary--\r\n';

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const CONFIG: DocumentGenerationProxyConfig = {
  accessCookieName: 'jsc-access-local',
  csrfCookieName: 'jsc-csrf-local',
  origin: 'https://documents.example.test',
  documentStoreOrigin: 'https://store.example.test',
  timeoutMs: 50,
};

describe('Document generation session boundary', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server?.close(error => error ? reject(error) : resolve()));
    }
    server = undefined;
    vi.restoreAllMocks();
  });

  async function start(fetchImplementation: typeof fetch): Promise<string> {
    const app = express();
    app.use(express.json());
    registerDocumentGenerationRoutes(app, CONFIG, fetchImplementation);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server?.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not bind');
    }
    return `http://127.0.0.1:${address.port}`;
  }

  function sessionHeaders(includeCsrf = true): Record<string, string> {
    return {
      Cookie: [
        `jsc-access-local=${ACCESS_TOKEN}`,
        ...(includeCsrf ? [`jsc-csrf-local=${CSRF_TOKEN}`] : []),
      ].join('; '),
      ...(includeCsrf ? {'X-CSRF-Token': CSRF_TOKEN} : {}),
    };
  }

  it('starts durable generation with cookie-derived identity and a validated idempotency key', async () => {
    const upstream = vi.fn<FetchLike>(async () =>
      Response.json({
        operationId: OPERATION_ID,
        state: 'AWAITING_APPROVAL',
        cvDocumentId: DOCUMENT_ID,
        coverLetterDocumentId: DOCUMENT_ID,
      }, {status: 202}));
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(`${origin}/api/v1/document-generation/saved-jobs/${DOCUMENT_ID}/operations`, {
      method: 'POST',
      headers: {
        ...sessionHeaders(),
        Authorization: 'Bearer browser-controlled',
        'Idempotency-Key': 'browser-safe-key',
        'Content-Type': 'application/json',
        'X-User-Id': 'another-user',
      },
    });

    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(upstream).toHaveBeenCalledOnce();
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe(
      `https://documents.example.test/api/v1/document-generation/saved-jobs/${DOCUMENT_ID}/operations`,
    );
    expect(init?.headers).toEqual({
      Accept: 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'browser-safe-key',
    });
    expect(JSON.stringify(init)).not.toContain('another-user');
    expect(JSON.stringify(init)).not.toContain('browser-controlled');
  });

  it('requires CSRF before a durable generation request reaches the gateway', async () => {
    const upstream = vi.fn<FetchLike>();
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(`${origin}/api/v1/document-generation/saved-jobs/${DOCUMENT_ID}/operations`, {
      method: 'POST',
      headers: {
        ...sessionHeaders(false),
        'Idempotency-Key': 'browser-safe-key',
        'Content-Type': 'application/json',
      },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'REQUEST_FORBIDDEN',
      message: 'A valid CSRF token is required',
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('approves only an exact operation through the session boundary', async () => {
    const upstream = vi.fn<FetchLike>(async () =>
      Response.json({operationId: OPERATION_ID, state: 'COMPLETED'}));
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/operations/${OPERATION_ID}/approve`,
      {
        method: 'POST',
        headers: {
          ...sessionHeaders(),
          Authorization: 'Bearer browser-controlled',
          'Content-Type': 'application/json',
          'X-User-Id': 'another-user',
        },
        body: JSON.stringify({
          cvDocumentId: DOCUMENT_ID,
          coverLetterDocumentId: DOCUMENT_ID,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledWith(
      `https://documents.example.test/api/v1/document-generation/operations/${OPERATION_ID}/approve`,
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }),
    );
    expect(JSON.stringify(upstream.mock.calls[0][1])).not.toContain('another-user');
    expect(JSON.stringify(upstream.mock.calls[0][1])).not.toContain('browser-controlled');
  });

  it('rejects an unsafe idempotency key before the gateway is called', async () => {
    const upstream = vi.fn<FetchLike>();
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/saved-jobs/${DOCUMENT_ID}/operations`,
      {
        method: 'POST',
        headers: {
          ...sessionHeaders(),
          'Idempotency-Key': 'unsafe key with spaces',
        },
      },
    );

    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('replaces an application document through the cookie session and CSRF boundary', async () => {
    const upstream = vi.fn<FetchLike>(async () =>
      Response.json({
        applicationId: APPLICATION_ID,
        cvDocumentId: DOCUMENT_ID,
        message: 'CV replaced',
      }));
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/applications/${APPLICATION_ID}/replace?documentType=CV`,
      {
        method: 'POST',
        headers: {
          ...sessionHeaders(),
          Authorization: 'Bearer browser-controlled',
          'X-User-Id': 'another-user',
          'Content-Type': MULTIPART_TYPE,
        },
        body: MULTIPART_BODY,
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      applicationId: APPLICATION_ID,
      cvDocumentId: DOCUMENT_ID,
      message: 'CV replaced',
    });
    expect(upstream).toHaveBeenCalledOnce();
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe(
      `https://documents.example.test/api/v1/document-generation/applications/${APPLICATION_ID}/replace?documentType=CV`,
    );
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual(expect.objectContaining({
      Accept: 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': expect.stringMatching(/^multipart\/form-data;\s*boundary=/i),
    }));
    expect(init?.headers).not.toHaveProperty('X-User-Id');
    expect(JSON.stringify(init?.headers)).not.toContain('browser-controlled');
    expect(init?.body).toBeInstanceOf(ArrayBuffer);
    expect(Buffer.from(init?.body as ArrayBuffer).toString('utf8')).toContain('Updated CV.docx');
  });

  it('requires CSRF before a replacement upload reaches the gateway', async () => {
    const upstream = vi.fn<FetchLike>();
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/applications/${APPLICATION_ID}/replace?documentType=CV`,
      {
        method: 'POST',
        headers: {
          ...sessionHeaders(false),
          'Content-Type': MULTIPART_TYPE,
        },
        body: MULTIPART_BODY,
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'REQUEST_FORBIDDEN',
      message: 'A valid CSRF token is required',
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects an invalid replacement document type before the gateway is called', async () => {
    const upstream = vi.fn<FetchLike>();
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/applications/${APPLICATION_ID}/replace?documentType=OTHER`,
      {method: 'POST', headers: sessionHeaders()},
    );

    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('loads owner-scoped latest files and returns only safe download metadata', async () => {
    const upstream = vi.fn<FetchLike>(async () =>
      Response.json([
        {
          id: FILE_ID,
          fileType: 'DOCX',
          fileName: 'Tailored CV.docx',
          active: true,
        },
        {
          id: '397f55ec-1662-4771-9037-6235c5e48d9d',
          fileType: 'PDF',
          fileName: 'Tailored CV.pdf',
          active: true,
        },
      ]));
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/documents/${DOCUMENT_ID}/files/latest`,
      {headers: sessionHeaders(false)},
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      docx: {
        fileId: FILE_ID,
        downloadUrl: `/api/v1/document-generation/files/${FILE_ID}/download`,
        fileName: 'Tailored CV.docx',
      },
      pdf: {
        fileId: '397f55ec-1662-4771-9037-6235c5e48d9d',
        downloadUrl: '/api/v1/document-generation/files/397f55ec-1662-4771-9037-6235c5e48d9d/download',
        fileName: 'Tailored CV.pdf',
      },
    });
    expect(upstream).toHaveBeenCalledWith(
      `https://store.example.test/api/v1/documents/${DOCUMENT_ID}/files/latest`,
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        method: 'GET',
      }),
    );
  });

  it('downloads an owner-scoped exported file without accepting browser auth', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const upstream = vi.fn<FetchLike>(async () =>
      new Response(bytes, {
        headers: {
          'Content-Disposition': 'attachment; filename="Tailored CV.pdf"',
          'Content-Type': 'application/pdf',
        },
      }));
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/files/${FILE_ID}/download`,
      {
        headers: {
          ...sessionHeaders(false),
          Authorization: 'Bearer browser-controlled',
          'X-User-Id': 'another-user',
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(upstream.mock.calls[0][1]?.headers).toEqual({
      Accept: 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    });
  });
});
