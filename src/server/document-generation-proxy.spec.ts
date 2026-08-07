import express from 'express';
import type {Server} from 'node:http';
import {
  type DocumentGenerationProxyConfig,
  registerDocumentGenerationRoutes,
} from './document-generation-proxy';

const ACCESS_TOKEN = 'a.a.a';
const CSRF_TOKEN = 'csrf-token-123';
const DOCUMENT_ID = '3b0f6a57-389d-4e20-a007-199afca04b20';
const COVER_DOCUMENT_ID = '3b0f6a57-389d-4e20-a007-199afca04b21';
const DOCUMENT_FAMILY_ID = '3b0f6a57-389d-4e20-a007-199afca04b22';
const FILE_ID = '9f40a536-4167-4b5c-9295-c41b6e127f84';
const ARTIFACT_ID = '7a7ca550-1a54-4ad2-956f-40d600b741ca';
const OPERATION_ID = '69e794d1-f0aa-4ed5-9779-a5f3e98610cb';
const APPLICATION_ID = 'c17442dd-c24f-48a2-86e5-b0ec7f38f8cb';
const SECOND_APPLICATION_ID = 'c17442dd-c24f-48a2-86e5-b0ec7f38f8cc';
const MULTIPART_TYPE = 'multipart/form-data; boundary=test-boundary';
const MULTIPART_BODY = '--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="Updated CV.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\nsafe-docx-test\r\n--test-boundary--\r\n';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVIDENCE_SELECTION = {
  documents: [
    {
      purpose: 'CV',
      entryIds: ['50000000-0000-4000-8000-000000000001'],
      sectionOrder: ['PROJECT'],
    },
    {
      purpose: 'COVER_LETTER',
      entryIds: ['50000000-0000-4000-8000-000000000002'],
      sectionOrder: ['VOLUNTEERING'],
    },
  ],
};

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

  async function start(
    fetchImplementation: typeof fetch,
    config: DocumentGenerationProxyConfig = CONFIG,
  ): Promise<string> {
    const app = express();
    app.use(express.json());
    registerDocumentGenerationRoutes(app, config, fetchImplementation);
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

  const applicationRecord = {
    id: APPLICATION_ID,
    userId: 'owner-from-session',
    jobId: 'job-1',
    canonicalJobId: 'canonical-job-1',
    provider: 'REED',
    externalJobId: 'reed-1',
    provenance: 'GENERATED',
    jobTitle: 'Platform Engineer',
    companyName: 'Example Ltd',
    status: 'DOCUMENTS_GENERATED',
    cvDocumentId: DOCUMENT_ID,
    coverLetterDocumentId: COVER_DOCUMENT_ID,
    version: 8,
    updatedAt: '2026-08-07T09:30:00Z',
  };

  it('returns only content-free exact-version associations', async () => {
    const upstream = vi.fn<FetchLike>(async () => Response.json({
      documentId: DOCUMENT_ID,
      associationCount: 99,
      associations: [
        {
          applicationId: APPLICATION_ID,
          documentType: 'CV',
          associationState: 'DRAFT_SELECTED',
          applicationStatus: 'DOCUMENTS_GENERATED',
          privateNotes: 'must-not-reach-browser',
        },
        {
          applicationId: SECOND_APPLICATION_ID,
          documentType: 'CV',
          associationState: 'FROZEN_USED',
          applicationStatus: 'APPLIED',
          frozenAt: '2026-08-07T09:30:00Z',
          contentSha256: 'must-not-reach-browser',
        },
        {
          applicationId: 'c17442dd-c24f-48a2-86e5-b0ec7f38f8cd',
          documentType: 'CV',
          associationState: 'FROZEN_USED',
          applicationStatus: 'APPLIED',
        },
      ],
      fileName: 'must-not-reach-browser.docx',
    }));
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/document-versions/${DOCUMENT_ID.toUpperCase()}/application-associations`,
      {headers: sessionHeaders(false)},
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toEqual({
      documentId: DOCUMENT_ID,
      associationCount: 3,
      associations: [
        {
          applicationId: APPLICATION_ID,
          documentType: 'CV',
          associationState: 'DRAFT_SELECTED',
          applicationStatus: 'DOCUMENTS_GENERATED',
        },
        {
          applicationId: SECOND_APPLICATION_ID,
          documentType: 'CV',
          associationState: 'FROZEN_USED',
          applicationStatus: 'APPLIED',
          frozenAt: '2026-08-07T09:30:00Z',
        },
        {
          applicationId: 'c17442dd-c24f-48a2-86e5-b0ec7f38f8cd',
          documentType: 'CV',
          associationState: 'FROZEN_USED',
          applicationStatus: 'APPLIED',
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('must-not-reach-browser');
    expect(upstream).toHaveBeenCalledWith(
      `https://documents.example.test/api/v1/document-generation/document-versions/${DOCUMENT_ID}/application-associations`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'X-Correlation-ID': expect.stringMatching(UUID_PATTERN),
        }),
      }),
    );
  });

  it.each([
    ['PATCH', 'archive', 'ARCHIVED', 'archivedAt'],
    ['PATCH', 'restore', 'AVAILABLE', undefined],
  ])('proxies %s lifecycle action %s through CSRF and sanitizes the result', async (
    method,
    action,
    retentionState,
    lifecycleTimestamp,
  ) => {
    const timestamp = '2026-08-07T09:30:00Z';
    const upstream = vi.fn<FetchLike>(async () => Response.json({
      id: DOCUMENT_ID,
      documentFamilyId: DOCUMENT_FAMILY_ID,
      documentType: 'CV',
      version: 4,
      lifecycleState: 'APPROVED',
      retentionState,
      current: false,
      ...(lifecycleTimestamp ? {[lifecycleTimestamp]: timestamp} : {}),
      purgeEligibleAt: retentionState === 'DELETED' ? '2026-09-06T09:30:00Z' : undefined,
      unavailableReason: retentionState === 'DELETED' ? 'RECOVERABLY_DELETED' : undefined,
      title: 'must-not-reach-browser',
      content: 'must-not-reach-browser',
    }));
    const origin = await start(upstream as typeof fetch);
    const suffix = action ? `/${action}` : '';

    const response = await fetch(
      `${origin}/api/v1/document-generation/document-versions/${DOCUMENT_ID}${suffix}`,
      {method, headers: sessionHeaders()},
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(expect.objectContaining({
      id: DOCUMENT_ID,
      documentFamilyId: DOCUMENT_FAMILY_ID,
      documentType: 'CV',
      version: 4,
      lifecycleState: 'APPROVED',
      retentionState,
      current: false,
    }));
    expect(JSON.stringify(body)).not.toContain('must-not-reach-browser');
    const [, init] = upstream.mock.calls[0];
    expect(init).toEqual(expect.objectContaining({
      method,
      headers: expect.objectContaining({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'X-Correlation-ID': expect.stringMatching(UUID_PATTERN),
      }),
    }));
    expect(JSON.stringify(init)).not.toContain('browser-controlled');
  });

  it('proxies recoverable deletion through CSRF without inventing lifecycle state', async () => {
    const upstream = vi.fn<FetchLike>(async () => new Response(null, {status: 204}));
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/document-versions/${DOCUMENT_ID}`,
      {method: 'DELETE', headers: sessionHeaders()},
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe(
      `https://documents.example.test/api/v1/document-generation/document-versions/${DOCUMENT_ID}`,
    );
    expect(init).toEqual(expect.objectContaining({
      method: 'DELETE',
      headers: expect.objectContaining({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'X-Correlation-ID': expect.stringMatching(UUID_PATTERN),
      }),
    }));
  });

  it('rejects lifecycle writes without CSRF before calling the gateway', async () => {
    const upstream = vi.fn<FetchLike>();
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/document-versions/${DOCUMENT_ID}/archive`,
      {method: 'PATCH', headers: sessionHeaders(false)},
    );

    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    ['none', {state: 'OMITTED'}, {state: 'OMITTED'}],
    ['CV only', {state: 'SELECTED', documentId: DOCUMENT_ID}, {state: 'OMITTED'}],
    ['cover letter only', {state: 'OMITTED'}, {state: 'SELECTED', documentId: COVER_DOCUMENT_ID}],
    ['both', {state: 'SELECTED', documentId: DOCUMENT_ID}, {state: 'SELECTED', documentId: COVER_DOCUMENT_ID}],
  ])('saves %s as one explicit owner-scoped selection request', async (
    _label,
    cvSelection,
    coverLetterSelection,
  ) => {
    const upstream = vi.fn<FetchLike>(async () => Response.json(applicationRecord));
    const origin = await start(upstream as typeof fetch);
    const requestBody = {cvSelection, coverLetterSelection, expectedVersion: 7};

    const response = await fetch(
      `${origin}/api/v1/document-generation/applications/${APPLICATION_ID.toUpperCase()}/document-selections`,
      {
        method: 'PUT',
        headers: {
          ...sessionHeaders(),
          Authorization: 'Bearer browser-controlled',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'selection-command-1',
          'X-User-Id': 'browser-controlled-owner',
        },
        body: JSON.stringify(requestBody),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      id: APPLICATION_ID,
      status: 'DOCUMENTS_GENERATED',
      cvDocumentId: DOCUMENT_ID,
      coverLetterDocumentId: COVER_DOCUMENT_ID,
      version: 8,
    });
    expect(upstream).toHaveBeenCalledOnce();
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe(
      `https://documents.example.test/api/v1/document-generation/applications/${APPLICATION_ID}/document-selections`,
    );
    expect(init).toEqual(expect.objectContaining({
      method: 'PUT',
      headers: expect.objectContaining({
        Accept: 'application/json',
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'selection-command-1',
        'X-Correlation-ID': expect.stringMatching(UUID_PATTERN),
      }),
    }));
    expect(JSON.stringify(init)).not.toContain('browser-controlled');
    expect(JSON.parse(String(init?.body))).toEqual(requestBody);
  });

  it.each([
    [{cvSelection: {state: 'OMITTED'}, coverLetterSelection: {state: 'OMITTED'}}],
    [{cvSelection: {state: 'SELECTED'}, coverLetterSelection: {state: 'OMITTED'}, expectedVersion: 0}],
    [{cvSelection: {state: 'SELECTED', documentId: 'not-a-uuid'}, coverLetterSelection: {state: 'OMITTED'}, expectedVersion: 0}],
    [{cvSelection: {state: 'OMITTED', documentId: DOCUMENT_ID}, coverLetterSelection: {state: 'OMITTED'}, expectedVersion: 0}],
    [{cvSelection: {state: 'OMITTED'}, coverLetterSelection: {state: 'OMITTED'}, expectedVersion: -1}],
    [{cvSelection: {state: 'OMITTED'}, coverLetterSelection: {state: 'OMITTED'}, expectedVersion: 1.5}],
    [{cvSelection: {state: 'OMITTED'}, coverLetterSelection: {state: 'OMITTED'}, expectedVersion: 0, ownerId: 'unsafe'}],
  ])('rejects an invalid complete-selection body before calling the gateway', async body => {
    const upstream = vi.fn<FetchLike>();
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/applications/${APPLICATION_ID}/document-selections`,
      {
        method: 'PUT',
        headers: {
          ...sessionHeaders(),
          'Content-Type': 'application/json',
          'Idempotency-Key': 'selection-command-1',
        },
        body: JSON.stringify(body),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'INVALID_DOCUMENT_SELECTIONS',
      message: 'Both document slots and a non-negative expected version are required',
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('requires valid application, idempotency and CSRF inputs before selection writes', async () => {
    const upstream = vi.fn<FetchLike>();
    const origin = await start(upstream as typeof fetch);
    const body = JSON.stringify({
      cvSelection: {state: 'OMITTED'},
      coverLetterSelection: {state: 'OMITTED'},
      expectedVersion: 0,
    });

    const invalidId = await fetch(
      `${origin}/api/v1/document-generation/applications/not-a-uuid/document-selections`,
      {method: 'PUT', headers: {...sessionHeaders(), 'Content-Type': 'application/json'}, body},
    );
    const invalidKey = await fetch(
      `${origin}/api/v1/document-generation/applications/${APPLICATION_ID}/document-selections`,
      {method: 'PUT', headers: {...sessionHeaders(), 'Content-Type': 'application/json', 'Idempotency-Key': 'unsafe key'}, body},
    );
    const missingCsrf = await fetch(
      `${origin}/api/v1/document-generation/applications/${APPLICATION_ID}/document-selections`,
      {
        method: 'PUT',
        headers: {...sessionHeaders(false), 'Content-Type': 'application/json', 'Idempotency-Key': 'selection-command-1'},
        body,
      },
    );

    expect(invalidId.status).toBe(400);
    expect(invalidKey.status).toBe(400);
    expect(missingCsrf.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('preserves only authoritative application state on a stale selection conflict', async () => {
    const upstream = vi.fn<FetchLike>(async () => Response.json({
      status: 409,
      message: 'internal persistence detail',
      timestamp: '2026-08-07T09:30:00Z',
      currentApplication: {
        ...applicationRecord,
        id: SECOND_APPLICATION_ID,
        cvDocumentId: undefined,
        version: 9,
        internalOwnerEmail: 'must-not-reach-browser@example.test',
      },
      internalTrace: 'must-not-reach-browser',
    }, {status: 409}));
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/applications/${APPLICATION_ID}/document-selections`,
      {
        method: 'PUT',
        headers: {
          ...sessionHeaders(),
          'Content-Type': 'application/json',
          'Idempotency-Key': 'stale-command',
        },
        body: JSON.stringify({
          cvSelection: {state: 'OMITTED'},
          coverLetterSelection: {state: 'SELECTED', documentId: COVER_DOCUMENT_ID},
          expectedVersion: 7,
        }),
      },
    );

    expect(response.status).toBe(409);
    const conflict = await response.json();
    expect(conflict).toEqual({
      status: 409,
      message: 'The application changed; review the current selections before saving again',
      currentApplication: expect.objectContaining({
        id: SECOND_APPLICATION_ID,
        coverLetterDocumentId: COVER_DOCUMENT_ID,
        version: 9,
      }),
    });
    expect(JSON.stringify(conflict)).not.toContain('internal');
    expect(JSON.stringify(conflict)).not.toContain('must-not-reach-browser');
  });

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
      body: JSON.stringify(EVIDENCE_SELECTION),
    });

    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(upstream).toHaveBeenCalledOnce();
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe(
      `https://documents.example.test/api/v1/document-generation/saved-jobs/${DOCUMENT_ID}/operations`,
    );
    expect(init?.headers).toEqual(expect.objectContaining({
      Accept: 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'browser-safe-key',
      'X-Correlation-ID': expect.stringMatching(UUID_PATTERN),
    }));
    expect(JSON.stringify(init)).not.toContain('another-user');
    expect(JSON.stringify(init)).not.toContain('browser-controlled');
    expect(JSON.parse(String(init?.body))).toEqual(EVIDENCE_SELECTION);
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
      body: JSON.stringify(EVIDENCE_SELECTION),
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
      Response.json(
        {operationId: OPERATION_ID, state: 'APPROVED'},
        {status: 202},
      ));
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
          coverLetterDocumentId: COVER_DOCUMENT_ID,
        }),
      },
    );

    expect(response.status).toBe(202);
    expect(upstream).toHaveBeenCalledWith(
      `https://documents.example.test/api/v1/document-generation/operations/${OPERATION_ID}/approve`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Correlation-ID': expect.stringMatching(UUID_PATTERN),
        }),
        method: 'POST',
      }),
    );
    expect(JSON.stringify(upstream.mock.calls[0][1])).not.toContain('another-user');
    expect(JSON.stringify(upstream.mock.calls[0][1])).not.toContain('browser-controlled');
    expect(JSON.parse(String(upstream.mock.calls[0][1]?.body))).toEqual({
      cvDocumentId: DOCUMENT_ID,
      coverLetterDocumentId: COVER_DOCUMENT_ID,
    });
  });

  it('rejects extra or invalid approval fields before the gateway is called', async () => {
    const upstream = vi.fn<FetchLike>();
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/operations/${OPERATION_ID}/approve`,
      {
        method: 'POST',
        headers: {
          ...sessionHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cvDocumentId: DOCUMENT_ID,
          coverLetterDocumentId: COVER_DOCUMENT_ID,
          ownerId: 'browser-asserted-owner',
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'INVALID_APPROVAL_REQUEST',
      message: 'Valid distinct CV and cover letter document identifiers are required',
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('loads an owner-scoped operation and propagates only a bounded correlation id', async () => {
    const upstream = vi.fn<FetchLike>(async () =>
      Response.json({
        operationId: OPERATION_ID,
        savedJobId: DOCUMENT_ID,
        state: 'GENERATION_IN_PROGRESS',
        replaySafe: true,
        downloads: {
          cv: {
            documentId: DOCUMENT_ID,
            exports: [{
              fileId: FILE_ID,
              format: 'DOCX',
              fileName: 'Tailored CV.docx',
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              downloadUrl: 'https://internal-store.example.test/private',
            }],
          },
        },
        failureMessage: 'provider body must not reach the browser',
        unexpected: 'hidden',
      }));
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/operations/${OPERATION_ID}`,
      {
        headers: {
          ...sessionHeaders(false),
          'X-Correlation-ID': 'browser.operation-1',
          'X-User-Id': 'another-user',
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-correlation-id')).toBe('browser.operation-1');
    expect(await response.json()).toEqual({
      operationId: OPERATION_ID,
      savedJobId: DOCUMENT_ID,
      state: 'GENERATION_IN_PROGRESS',
      replaySafe: true,
      downloads: {
        cv: {
          exports: [{
            fileId: FILE_ID,
            format: 'DOCX',
            fileName: 'Tailored CV.docx',
          }],
        },
      },
    });
    expect(upstream).toHaveBeenCalledWith(
      `https://documents.example.test/api/v1/document-generation/operations/${OPERATION_ID}`,
      expect.objectContaining({
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'X-Correlation-ID': 'browser.operation-1',
        },
      }),
    );
  });

  it('maps a stalled operation response body to the existing generation timeout contract', async () => {
    let capturedSignal: AbortSignal | undefined;
    const downstreamResponse = new Response(null, {
      status: 200,
      headers: {'Content-Type': 'application/json'},
    });
    const downstreamText = vi.spyOn(downstreamResponse, 'text').mockImplementation(
      () => new Promise<string>(() => undefined),
    );
    const upstream = vi.fn<FetchLike>(async (_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return downstreamResponse;
    });
    const origin = await start(
      upstream as typeof fetch,
      {...CONFIG, timeoutMs: 5},
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await fetch(
      `${origin}/api/v1/document-generation/operations/${OPERATION_ID}`,
      {headers: sessionHeaders(false)},
    );

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      error: 'GENERATION_TIMEOUT',
      message: 'The document generation request timed out; its outcome may still be processing',
    });
    expect(response.headers.get('x-correlation-id')).toMatch(UUID_PATTERN);
    expect(downstreamText).toHaveBeenCalledOnce();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('cancels an exact operation through CSRF and replaces an unsafe correlation id', async () => {
    const upstream = vi.fn<FetchLike>(async () =>
      Response.json({
        operationId: OPERATION_ID,
        state: 'CANCELLED',
      }));
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/operations/${OPERATION_ID}`,
      {
        method: 'DELETE',
        headers: {
          ...sessionHeaders(),
          'X-Correlation-ID': 'contains spaces and must be replaced',
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-correlation-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(await response.json()).toEqual({
      operationId: OPERATION_ID,
      state: 'CANCELLED',
    });
    expect(upstream.mock.calls[0][1]).toEqual(expect.objectContaining({
      method: 'DELETE',
    }));
  });

  it('requires CSRF before operation cancellation reaches the gateway', async () => {
    const upstream = vi.fn<FetchLike>();
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/operations/${OPERATION_ID}`,
      {method: 'DELETE', headers: sessionHeaders(false)},
    );

    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('returns a stable error without reflecting a downstream provider body', async () => {
    const upstream = vi.fn<FetchLike>(async () =>
      Response.json({
        error: 'PROVIDER_RATE_LIMITED',
        message: 'provider response contained claimant data',
      }, {status: 429}));
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/operations/${OPERATION_ID}`,
      {headers: sessionHeaders(false)},
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: 'GENERATION_RATE_LIMITED',
      message: 'Document generation is temporarily rate limited',
    });
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

  it('rejects empty or browser-asserted evidence metadata before the gateway is called', async () => {
    const upstream = vi.fn<FetchLike>();
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/saved-jobs/${DOCUMENT_ID}/operations`,
      {
        method: 'POST',
        headers: {
          ...sessionHeaders(),
          'Idempotency-Key': 'browser-safe-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documents: [
            {...EVIDENCE_SELECTION.documents[0], confirmationState: 'USER_CONFIRMED'},
            {...EVIDENCE_SELECTION.documents[1], factIds: [FILE_ID]},
          ],
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'INVALID_EVIDENCE_SELECTION',
      message: 'Choose valid confirmed evidence separately for the CV and cover letter',
    });
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

  it('maps a stalled replacement response body to the existing timeout contract', async () => {
    let capturedSignal: AbortSignal | undefined;
    const downstreamResponse = new Response(null, {
      status: 200,
      headers: {'Content-Type': 'application/json'},
    });
    const downstreamText = vi.spyOn(downstreamResponse, 'text').mockImplementation(
      () => new Promise<string>(() => undefined),
    );
    const upstream = vi.fn<FetchLike>(async (_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return downstreamResponse;
    });
    const origin = await start(
      upstream as typeof fetch,
      {...CONFIG, timeoutMs: 5},
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await fetch(
      `${origin}/api/v1/document-generation/applications/${APPLICATION_ID}/replace?documentType=CV`,
      {
        method: 'POST',
        headers: {
          ...sessionHeaders(),
          'Content-Type': MULTIPART_TYPE,
        },
        body: MULTIPART_BODY,
      },
    );

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      error: 'DOWNSTREAM_TIMEOUT',
      message: 'Document replacement timed out',
    });
    expect(downstreamText).toHaveBeenCalledOnce();
    expect(capturedSignal?.aborted).toBe(true);
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

  it('rejects invalid download headers before buffering the response body', async () => {
    const downstreamResponse = new Response(null, {
      status: 200,
      headers: {'Content-Type': 'text/html'},
    });
    const downstreamBody = vi.spyOn(downstreamResponse, 'arrayBuffer');
    const upstream = vi.fn<FetchLike>(async () => downstreamResponse);
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/files/${FILE_ID}/download`,
      {headers: sessionHeaders(false)},
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'INVALID_DOWNSTREAM_RESPONSE',
      message: 'The document service returned an invalid file',
    });
    expect(downstreamBody).not.toHaveBeenCalled();
  });

  it('maps a stalled document body to timeout before exposing download headers', async () => {
    let capturedSignal: AbortSignal | undefined;
    const downstreamResponse = new Response(null, {
      status: 200,
      headers: {
        'Content-Disposition': 'attachment; filename="Private CV.pdf"',
        'Content-Type': 'application/pdf',
      },
    });
    const downstreamBody = vi.spyOn(downstreamResponse, 'arrayBuffer').mockImplementation(
      () => new Promise<ArrayBuffer>(() => undefined),
    );
    const upstream = vi.fn<FetchLike>(async (_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return downstreamResponse;
    });
    const origin = await start(
      upstream as typeof fetch,
      {...CONFIG, timeoutMs: 5},
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await fetch(
      `${origin}/api/v1/document-generation/files/${FILE_ID}/download`,
      {headers: sessionHeaders(false)},
    );

    expect(response.status).toBe(504);
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(await response.json()).toEqual({
      error: 'DOWNSTREAM_TIMEOUT',
      message: 'Document download timed out',
    });
    expect(downstreamBody).toHaveBeenCalledOnce();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('downloads one exact retained artifact and preserves the complete security policy', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const upstream = vi.fn<FetchLike>(async () =>
      new Response(bytes, {
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
          'Content-Disposition': 'attachment; filename="Tailored CV.docx"',
          'Content-Length': String(bytes.byteLength),
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          Pragma: 'no-cache',
          'X-Content-Type-Options': 'nosniff',
        },
      }));
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/documents/${DOCUMENT_ID.toUpperCase()}/artifacts/${ARTIFACT_ID.toUpperCase()}/download`,
      {
        headers: {
          ...sessionHeaders(false),
          Authorization: 'Bearer browser-controlled',
          'X-User-Id': 'another-user',
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="Tailored CV.docx"');
    expect(response.headers.get('content-length')).toBe(String(bytes.byteLength));
    expect(response.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(upstream).toHaveBeenCalledWith(
      `https://documents.example.test/api/v1/document-generation/documents/${DOCUMENT_ID}/artifacts/${ARTIFACT_ID}/download`,
      expect.objectContaining({
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
      }),
    );
  });

  it.each([
    [`not-${DOCUMENT_ID}`, ARTIFACT_ID],
    [DOCUMENT_ID, `not-${ARTIFACT_ID}`],
  ])('rejects malformed exact artifact boundaries before calling the gateway', async (
    documentId,
    artifactId,
  ) => {
    const upstream = vi.fn<FetchLike>();
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/documents/${documentId}/artifacts/${artifactId}/download`,
      {headers: sessionHeaders(false)},
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'INVALID_DOCUMENT_ARTIFACT_ID',
      message: 'Valid document and artifact identifiers are required',
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('does not allow an extra path segment to escape the exact artifact boundary', async () => {
    const upstream = vi.fn<FetchLike>();
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/documents/${DOCUMENT_ID}/artifacts/${ARTIFACT_ID}/download/extra`,
      {headers: sessionHeaders(false)},
    );

    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('preserves a non-enumerating mismatch denial without reflecting downstream details', async () => {
    const upstream = vi.fn<FetchLike>(async () => Response.json({
      message: 'artifact belongs to another owner',
      objectUrl: 'https://internal-store.example.test/private-object',
    }, {status: 404}));
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/documents/${DOCUMENT_ID}/artifacts/${ARTIFACT_ID}/download`,
      {headers: sessionHeaders(false)},
    );

    expect(response.status).toBe(404);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      error: 'DOCUMENT_ARTIFACT_DOWNLOAD_FAILED',
      message: 'The document artifact could not be downloaded',
    });
    expect(body).not.toContain('another owner');
    expect(body).not.toContain('internal-store');
  });

  it('fails closed before buffering when exact artifact security headers are incomplete', async () => {
    const downstreamResponse = new Response(null, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Disposition': 'attachment; filename="Tailored CV.pdf"',
        'Content-Length': '4',
        'Content-Type': 'application/pdf',
        Pragma: 'no-cache',
      },
    });
    const downstreamBody = vi.spyOn(downstreamResponse, 'arrayBuffer');
    const upstream = vi.fn<FetchLike>(async () => downstreamResponse);
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/documents/${DOCUMENT_ID}/artifacts/${ARTIFACT_ID}/download`,
      {headers: sessionHeaders(false)},
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'INVALID_DOWNSTREAM_RESPONSE',
      message: 'The document service returned an invalid file',
    });
    expect(downstreamBody).not.toHaveBeenCalled();
  });

  it('fails closed when exact artifact bytes do not match the declared length', async () => {
    const upstream = vi.fn<FetchLike>(async () => new Response(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      {
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
          'Content-Disposition': 'attachment; filename="Tailored CV.pdf"',
          'Content-Length': '5',
          'Content-Type': 'application/pdf',
          Pragma: 'no-cache',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    ));
    const origin = await start(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/v1/document-generation/documents/${DOCUMENT_ID}/artifacts/${ARTIFACT_ID}/download`,
      {headers: sessionHeaders(false)},
    );

    expect(response.status).toBe(502);
    expect(response.headers.get('content-disposition')).toBeNull();
  });
});
