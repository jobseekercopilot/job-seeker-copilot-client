import {HttpClient, HttpEventType, HttpResponse} from '@angular/common/http';
import {TestBed} from '@angular/core/testing';
import {firstValueFrom, NEVER, of, Subject, throwError} from 'rxjs';
import {
  DocumentEvidenceSelectionPurposeEnum,
  DocumentEvidenceSelectionSectionOrderEnum,
  ApplicationDocumentUploadControllerService,
  DocumentGenerationControllerService,
  GenerationOperationResponse,
  GenerationOperationResponseStateEnum,
} from '../api/document-generation-gateway';
import {SavedJobsService} from '../api/job-finder';
import {Job} from '../models/job-search.model';
import {BrowserSessionService} from './browser-session.service';
import {
  DocumentArtifactManifestItem,
  DocumentGenerationService,
  GenerationEvidenceSelection,
  documentArtifactDownloadLabel,
} from './document-generation.service';

describe('DocumentGenerationService', () => {
  const storage = new Map<string, string>();
  const ownerId = '10000000-0000-4000-8000-000000000001';
  const canonicalJobId = '20000000-0000-4000-8000-000000000001';
  const savedJobId = '30000000-0000-4000-8000-000000000001';
  const operationId = '40000000-0000-4000-8000-000000000001';
  const cvDocumentId = '50000000-0000-4000-8000-000000000001';
  const coverLetterDocumentId = '50000000-0000-4000-8000-000000000002';
  const applicationId = '60000000-0000-4000-8000-000000000001';
  let currentOwnerId = ownerId;
  let refreshCsrf: ReturnType<typeof vi.fn>;
  let ensureCsrf: ReturnType<typeof vi.fn>;
  let save: ReturnType<typeof vi.fn>;
  let startOperation: ReturnType<typeof vi.fn>;
  let getOperation: ReturnType<typeof vi.fn>;
  let approveOperation: ReturnType<typeof vi.fn>;
  let cancelOperation: ReturnType<typeof vi.fn>;
  let httpPost: ReturnType<typeof vi.fn>;
  let uploadApplicationDocument: ReturnType<typeof vi.fn>;
  let getApplicationDocumentUpload: ReturnType<typeof vi.fn>;

  const job = {
    id: canonicalJobId,
    canonicalJobId,
    title: 'Software Engineer',
    company: 'Example Ltd',
    description: 'Build accessible software.',
  } as Job;
  const evidence: GenerationEvidenceSelection = {
    cv: {
      entryIds: ['70000000-0000-4000-8000-000000000001'],
      sectionOrder: [DocumentEvidenceSelectionSectionOrderEnum.Employment],
    },
    coverLetter: {
      entryIds: ['70000000-0000-4000-8000-000000000002'],
      sectionOrder: [DocumentEvidenceSelectionSectionOrderEnum.Project],
    },
  };

  beforeAll(() => {
    vi.stubGlobal('localStorage', {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    });
  });

  afterAll(() => vi.unstubAllGlobals());

  beforeEach(() => {
    localStorage.clear();
    currentOwnerId = ownerId;
    refreshCsrf = vi.fn(() => of(undefined));
    ensureCsrf = vi.fn(() => of(undefined));
    save = vi.fn(() => of({savedJobId}));
    startOperation = vi.fn(() => of({
      operationId,
      state: 'CREATED',
    }));
    getOperation = vi.fn(() => of({
      operationId,
      state: 'AWAITING_APPROVAL',
      cvDocumentId,
      coverLetterDocumentId,
    }));
    approveOperation = vi.fn(() => of(completedOperation()));
    cancelOperation = vi.fn(() => of({
      operationId,
      state: 'CANCELLED',
    }));
    httpPost = vi.fn();
    uploadApplicationDocument = vi.fn();
    getApplicationDocumentUpload = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        DocumentGenerationService,
        {
          provide: BrowserSessionService,
          useValue: {
            refreshCsrf,
            ensureCsrf,
            user: () => ({id: currentOwnerId}),
          },
        },
        {provide: SavedJobsService, useValue: {save}},
        {
          provide: DocumentGenerationControllerService,
          useValue: {
            startOperation,
            getOperation,
            approveOperation,
            cancelOperation,
          },
        },
        {
          provide: ApplicationDocumentUploadControllerService,
          useValue: {
            upload: uploadApplicationDocument,
            get: getApplicationDocumentUpload,
          },
        },
        {provide: HttpClient, useValue: {post: httpPost}},
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('derives safe download labels only from available artifact manifest metadata', () => {
    const artifact = {
      artifactId: '70000000-0000-4000-8000-000000000003',
      role: 'ORIGINAL',
      format: 'DOCX',
      source: 'USER_UPLOADED',
      availability: 'AVAILABLE',
      size: 4,
    } satisfies DocumentArtifactManifestItem;

    expect(documentArtifactDownloadLabel(artifact)).toBe('Download original');
    expect(documentArtifactDownloadLabel({
      ...artifact,
      role: 'DERIVED',
    })).toBe('Download DOCX');
    expect(documentArtifactDownloadLabel({
      ...artifact,
      role: 'DERIVED',
      format: 'PDF',
    })).toBe('Download PDF');
    expect(documentArtifactDownloadLabel({
      ...artifact,
      availability: 'UNAVAILABLE',
    })).toBeUndefined();
  });

  it('downloads an exact available artifact only through the same-origin BFF route', async () => {
    const artifact = {
      artifactId: '7A7CA550-1A54-4AD2-956F-40D600B741CA',
      role: 'DERIVED',
      format: 'PDF',
      source: 'SYSTEM_GENERATED',
      availability: 'AVAILABLE',
      size: 4,
    } satisfies DocumentArtifactManifestItem;
    const fetchRequest = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      {
        headers: {
          'Content-Disposition': 'attachment; filename="Tailored CV.pdf"',
          'Content-Type': 'application/pdf',
        },
      },
    ));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:safe-download');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await TestBed.inject(DocumentGenerationService).downloadArtifact(
      cvDocumentId.toUpperCase(),
      artifact,
    );

    expect(fetchRequest).toHaveBeenCalledWith(
      `/api/v1/document-generation/documents/${cvDocumentId}/artifacts/${artifact.artifactId.toLowerCase()}/download`,
      {method: 'GET'},
    );
    expect(fetchRequest.mock.calls[0][0]).not.toContain('http');
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:safe-download');
  });

  it.each([
    ['invalid-document', '70000000-0000-4000-8000-000000000003', 'AVAILABLE'],
    [cvDocumentId, 'invalid-artifact', 'AVAILABLE'],
    [cvDocumentId, '70000000-0000-4000-8000-000000000003', 'UNAVAILABLE'],
  ])('rejects unsafe artifact download metadata before any network request', async (
    documentId,
    artifactId,
    availability,
  ) => {
    const fetchRequest = vi.spyOn(globalThis, 'fetch');
    const artifact = {
      artifactId,
      role: 'DERIVED',
      format: 'DOCX',
      source: 'SYSTEM_GENERATED',
      availability,
      size: 4,
    } as DocumentArtifactManifestItem;

    await expect(
      TestBed.inject(DocumentGenerationService).downloadArtifact(documentId, artifact),
    ).rejects.toThrow('A safe available document artifact is required.');
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it('uses one durable operation and waits for its authoritative completed state', async () => {
    const removeItem = vi.spyOn(localStorage, 'removeItem');
    const calls: string[] = [];
    refreshCsrf.mockImplementation(() => {
      calls.push('csrf');
      return of(undefined);
    });
    save.mockImplementation(() => {
      calls.push('save');
      return of({savedJobId});
    });
    startOperation.mockImplementation(() => {
      calls.push('start');
      return of({operationId, state: 'CREATED'});
    });
    getOperation.mockImplementation(() => {
      calls.push('get');
      return of({
        operationId,
        state: 'AWAITING_APPROVAL',
        cvDocumentId,
        coverLetterDocumentId,
      });
    });
    approveOperation.mockImplementation(() => {
      calls.push('approve');
      return of(completedOperation());
    });

    const response = await firstValueFrom(
      TestBed.inject(DocumentGenerationService).generate(job, evidence),
    );

    expect(response.applicationId).toBe(applicationId);
    expect(removeItem).toHaveBeenCalled();
    expect(calls).toEqual(['csrf', 'save', 'start', 'get', 'approve']);
    expect(startOperation).toHaveBeenCalledWith(
      savedJobId,
      expect.stringMatching(/^browser-/),
      {
        outputs: ['CV', 'COVER_LETTER'],
        documents: [
          {
            purpose: DocumentEvidenceSelectionPurposeEnum.Cv,
            entryIds: evidence.cv.entryIds,
            sectionOrder: evidence.cv.sectionOrder,
          },
          {
            purpose: DocumentEvidenceSelectionPurposeEnum.CoverLetter,
            entryIds: evidence.coverLetter.entryIds,
            sectionOrder: evidence.coverLetter.sectionOrder,
          },
        ],
      },
      'body',
      false,
      {transferCache: false},
    );
    expect(localStorage.getItem(`jsc-document-generation-v1:${ownerId}`)).toBeNull();
    expect(TestBed.inject(DocumentGenerationService).pendingGenerations()).toEqual([]);
  });

  it('removes transient application enrichment from the canonical saved-job snapshot', async () => {
    const enrichedJob = {
      ...job,
      matchScore: 0.91,
      distanceMiles: 4.2,
      applicationStatus: 'NEW',
      applicationId,
      cvDocumentId,
      coverLetterDocumentId,
      appliedAt: '2026-07-29T22:20:00',
      applicationUpdatedAt: '2026-07-29T22:23:45.703863984',
    } satisfies Job;
    const original = structuredClone(enrichedJob);

    await expect(firstValueFrom(
      TestBed.inject(DocumentGenerationService).generate(enrichedJob, evidence),
    )).resolves.toMatchObject({applicationId});

    expect(save).toHaveBeenCalledWith(
      job,
      'body',
      false,
      {transferCache: false},
    );
    expect(enrichedJob).toEqual(original);
  });

  it('polls after asynchronous approval instead of treating 202 as completion', async () => {
    vi.useFakeTimers();
    getOperation
      .mockImplementationOnce(() => of({
        operationId,
        state: 'AWAITING_APPROVAL',
        cvDocumentId,
        coverLetterDocumentId,
      }))
      .mockImplementationOnce(() => of(completedOperation()));
    approveOperation.mockReturnValue(of({
      operationId,
      state: 'AWAITING_APPROVAL',
      cvDocumentId,
      coverLetterDocumentId,
    }));

    const result = firstValueFrom(
      TestBed.inject(DocumentGenerationService).generate(job, evidence),
    );
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(result).resolves.toMatchObject({applicationId});
    expect(getOperation).toHaveBeenCalledTimes(2);
    expect(approveOperation).toHaveBeenCalledOnce();
  });

  it('polls a fresh accepted operation without replaying its start request', async () => {
    vi.useFakeTimers();
    getOperation
      .mockImplementationOnce(() => of({
        operationId,
        state: 'CREATED',
        replaySafe: true,
      }))
      .mockImplementationOnce(() => of({
        operationId,
        state: 'AWAITING_APPROVAL',
        replaySafe: true,
        cvDocumentId,
        coverLetterDocumentId,
      }));

    const result = firstValueFrom(
      TestBed.inject(DocumentGenerationService).generate(job, evidence),
    );
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(result).resolves.toMatchObject({applicationId});
    expect(startOperation).toHaveBeenCalledOnce();
    expect(getOperation).toHaveBeenCalledTimes(2);
    expect(approveOperation).toHaveBeenCalledOnce();
  });

  it('replays a fresh replay-safe downstream failure once with the same durable request', async () => {
    vi.useFakeTimers();
    startOperation
      .mockImplementationOnce(() => of({
        operationId,
        state: 'CREATED',
      }))
      .mockImplementationOnce(() => of({
        operationId,
        state: 'CREDIT_COMMITTED',
        replaySafe: true,
        failureCode: 'DOWNSTREAM_RETRYABLE',
      }));
    getOperation
      .mockImplementationOnce(() => of({
        operationId,
        state: 'CREDIT_COMMITTED',
        replaySafe: true,
        failureCode: 'DOWNSTREAM_RETRYABLE',
      }))
      .mockImplementationOnce(() => of({
        operationId,
        state: 'AWAITING_APPROVAL',
        replaySafe: true,
        cvDocumentId,
        coverLetterDocumentId,
      }));

    const result = firstValueFrom(
      TestBed.inject(DocumentGenerationService).generate(job, evidence),
    );
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(result).resolves.toMatchObject({applicationId});
    expect(startOperation).toHaveBeenCalledTimes(2);
    expect(startOperation.mock.calls[1]).toEqual(startOperation.mock.calls[0]);
    expect(getOperation).toHaveBeenCalledTimes(2);
  });

  it('fails promptly and retains recovery evidence when replay remains downstream retryable', async () => {
    vi.useFakeTimers();
    startOperation
      .mockImplementationOnce(() => of({
        operationId,
        state: 'CREATED',
      }))
      .mockImplementationOnce(() => of({
        operationId,
        state: 'CREDIT_COMMITTED',
        replaySafe: true,
        failureCode: 'DOWNSTREAM_RETRYABLE',
      }));
    getOperation.mockReturnValue(of({
      operationId,
      state: 'CREDIT_COMMITTED',
      replaySafe: true,
      failureCode: 'DOWNSTREAM_RETRYABLE',
    }));
    const service = TestBed.inject(DocumentGenerationService);
    const errors: unknown[] = [];

    service.generate(job, evidence).subscribe({error: error => errors.push(error)});
    await vi.advanceTimersByTimeAsync(1_500);

    expect(errors).toEqual([
      expect.objectContaining({
        code: 'FAILED',
        message: expect.stringContaining('resume the same operation safely'),
      }),
    ]);
    expect(startOperation).toHaveBeenCalledTimes(2);
    expect(getOperation).toHaveBeenCalledTimes(2);
    expect(service.pendingGenerations()).toEqual([
      expect.objectContaining({
        canonicalJobId,
        operationId,
        evidence,
      }),
    ]);
  });

  it('bounds a stuck operation-status request and retains the resumable attempt', async () => {
    vi.useFakeTimers();
    getOperation.mockReturnValue(NEVER);
    const service = TestBed.inject(DocumentGenerationService);
    const errors: unknown[] = [];

    service.generate(job, evidence).subscribe({error: error => errors.push(error)});
    await vi.advanceTimersByTimeAsync(75_000);

    expect(errors).toEqual([
      expect.objectContaining({
        code: 'TIMEOUT',
        message: expect.stringContaining('Check your connection'),
      }),
    ]);
    expect(getOperation).toHaveBeenCalledOnce();
    expect(service.pendingGenerations()).toEqual([
      expect.objectContaining({canonicalJobId, operationId}),
    ]);
  });

  it('coalesces repeated generate activations into one write workflow', async () => {
    const service = TestBed.inject(DocumentGenerationService);
    const first = service.generate(job, evidence);
    const second = service.generate(job, evidence);

    expect(second).toBe(first);
    await Promise.all([firstValueFrom(first), firstValueFrom(second)]);
    expect(save).toHaveBeenCalledOnce();
    expect(startOperation).toHaveBeenCalledOnce();
    expect(approveOperation).toHaveBeenCalledOnce();
  });

  it('replays only a safe pre-provider checkpoint with the persisted key and request', async () => {
    writeAttempt({operationId});
    getOperation.mockReturnValue(of({operationId, state: 'DRAFTS_STORED'}));
    startOperation.mockReturnValue(of({
      operationId,
      state: 'AWAITING_APPROVAL',
      cvDocumentId,
      coverLetterDocumentId,
    }));

    const response = await firstValueFrom(
      TestBed.inject(DocumentGenerationService).resume(canonicalJobId),
    );

    expect(response.applicationId).toBe(applicationId);
    expect(startOperation).toHaveBeenCalledWith(
      savedJobId,
      'browser-stable-key',
      expect.objectContaining({
        documents: expect.any(Array),
      }),
      'body',
      false,
      {transferCache: false},
    );
  });

  it('explicitly replays an expired retryable checkpoint and adopts its renewed deadline', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    writeAttempt({
      operationId,
      startedAt: now - (11 * 60 * 1000),
    });
    getOperation
      .mockImplementationOnce(() => of({
        operationId,
        state: 'CREDIT_COMMITTED',
        replaySafe: true,
        failureCode: 'DOWNSTREAM_RETRYABLE',
        deadlineAt: new Date(now - 60_000).toISOString(),
      }))
      .mockImplementationOnce(() => of({
        operationId,
        state: 'AWAITING_APPROVAL',
        replaySafe: true,
        cvDocumentId,
        coverLetterDocumentId,
      }));
    startOperation.mockReturnValue(of({
      operationId,
      state: 'CREDIT_COMMITTED',
      replaySafe: true,
      failureCode: 'DOWNSTREAM_RETRYABLE',
      deadlineAt: new Date(now + (10 * 60 * 1000)).toISOString(),
    }));
    const service = TestBed.inject(DocumentGenerationService);

    expect(service.pendingGenerations()).toEqual([]);
    const result = firstValueFrom(service.generate(job, evidence));
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(result).resolves.toMatchObject({applicationId});
    expect(save).not.toHaveBeenCalled();
    expect(startOperation).toHaveBeenCalledOnce();
    expect(startOperation).toHaveBeenCalledWith(
      savedJobId,
      'browser-stable-key',
      expect.objectContaining({documents: expect.any(Array)}),
      'body',
      false,
      {transferCache: false},
    );
    expect(getOperation).toHaveBeenCalledTimes(2);
  });

  it('replays terminal deadline recovery with the exact retained request and renewed deadline', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    writeAttempt({
      operationId,
      startedAt: now - (11 * 60 * 1000),
    });
    const changedEvidence: GenerationEvidenceSelection = {
      cv: {
        entryIds: ['70000000-0000-4000-8000-000000000099'],
        sectionOrder: [DocumentEvidenceSelectionSectionOrderEnum.Project],
      },
      coverLetter: {
        entryIds: ['70000000-0000-4000-8000-000000000098'],
        sectionOrder: [DocumentEvidenceSelectionSectionOrderEnum.Education],
      },
    };
    getOperation
      .mockImplementationOnce(() => of({
        operationId,
        state: GenerationOperationResponseStateEnum.RecoveryRequired,
        replaySafe: false,
        failureCode: 'OPERATION_DEADLINE_RECOVERY_REQUIRED',
        deadlineAt: new Date(now - 60_000).toISOString(),
      }))
      .mockImplementationOnce(() => of({
        operationId,
        state: GenerationOperationResponseStateEnum.AwaitingApproval,
        replaySafe: true,
        cvDocumentId,
        coverLetterDocumentId,
      }));
    startOperation.mockReturnValue(of({
      operationId,
      state: GenerationOperationResponseStateEnum.RecoveryRequired,
      replaySafe: false,
      failureCode: 'OPERATION_DEADLINE_RECOVERY_REQUIRED',
      deadlineAt: new Date(now + (10 * 60 * 1000)).toISOString(),
    }));
    const service = TestBed.inject(DocumentGenerationService);

    const result = firstValueFrom(service.generate(job, changedEvidence));
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(result).resolves.toMatchObject({applicationId});
    expect(save).not.toHaveBeenCalled();
    expect(startOperation).toHaveBeenCalledOnce();
    expect(startOperation).toHaveBeenCalledWith(
      savedJobId,
      'browser-stable-key',
      {
        outputs: ['CV', 'COVER_LETTER'],
        documents: [
          {
            purpose: DocumentEvidenceSelectionPurposeEnum.Cv,
            entryIds: evidence.cv.entryIds,
            sectionOrder: evidence.cv.sectionOrder,
          },
          {
            purpose: DocumentEvidenceSelectionPurposeEnum.CoverLetter,
            entryIds: evidence.coverLetter.entryIds,
            sectionOrder: evidence.coverLetter.sectionOrder,
          },
        ],
      },
      'body',
      false,
      {transferCache: false},
    );
    expect(getOperation).toHaveBeenCalledTimes(2);
  });

  it('restarts an expired pre-provider operation with its retained request', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    writeAttempt({
      operationId,
      startedAt: now - (11 * 60 * 1000),
    });
    getOperation
      .mockImplementationOnce(() => of({
        operationId,
        state: GenerationOperationResponseStateEnum.Failed,
        replaySafe: true,
        failureCode: 'OPERATION_DEADLINE_EXCEEDED',
        deadlineAt: new Date(now - 60_000).toISOString(),
      }))
      .mockImplementationOnce(() => of({
        operationId,
        state: GenerationOperationResponseStateEnum.AwaitingApproval,
        replaySafe: true,
        cvDocumentId,
        coverLetterDocumentId,
      }));
    startOperation.mockReturnValue(of({
      operationId,
      state: GenerationOperationResponseStateEnum.SnapshotsResolved,
      replaySafe: true,
      deadlineAt: new Date(now + (10 * 60 * 1000)).toISOString(),
    }));
    const service = TestBed.inject(DocumentGenerationService);

    const result = firstValueFrom(service.generate(job, evidence));
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(result).resolves.toMatchObject({applicationId});
    expect(save).not.toHaveBeenCalled();
    expect(startOperation).toHaveBeenCalledOnce();
    expect(startOperation).toHaveBeenCalledWith(
      savedJobId,
      'browser-stable-key',
      {
        outputs: ['CV', 'COVER_LETTER'],
        documents: [
          {
            purpose: DocumentEvidenceSelectionPurposeEnum.Cv,
            entryIds: evidence.cv.entryIds,
            sectionOrder: evidence.cv.sectionOrder,
          },
          {
            purpose: DocumentEvidenceSelectionPurposeEnum.CoverLetter,
            entryIds: evidence.coverLetter.entryIds,
            sectionOrder: evidence.coverLetter.sectionOrder,
          },
        ],
      },
      'body',
      false,
      {transferCache: false},
    );
    expect(getOperation).toHaveBeenCalledTimes(2);
  });

  it.each([false, undefined])(
    'does not replay an expired operation unless the gateway explicitly marks it safe (%s)',
    async replaySafe => {
      writeAttempt({operationId});
      getOperation.mockReturnValue(of({
        operationId,
        state: GenerationOperationResponseStateEnum.Failed,
        replaySafe,
        failureCode: 'OPERATION_DEADLINE_EXCEEDED',
      }));
      const service = TestBed.inject(DocumentGenerationService);

      await expect(firstValueFrom(service.generate(job, evidence))).rejects.toMatchObject({
        code: 'TIMEOUT',
        message: expect.stringContaining('expired before the AI request started'),
      });

      expect(startOperation).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(service.pendingGenerations()).toEqual([
        expect.objectContaining({canonicalJobId, operationId, evidence}),
      ]);
    },
  );

  it('fails persistent terminal deadline recovery once and retains the original attempt', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    writeAttempt({operationId});
    getOperation.mockReturnValue(of({
      operationId,
      state: GenerationOperationResponseStateEnum.RecoveryRequired,
      replaySafe: false,
      failureCode: 'OPERATION_DEADLINE_RECOVERY_REQUIRED',
    }));
    startOperation.mockReturnValue(of({
      operationId,
      state: GenerationOperationResponseStateEnum.RecoveryRequired,
      replaySafe: false,
      failureCode: 'OPERATION_DEADLINE_RECOVERY_REQUIRED',
      deadlineAt: new Date(now + (10 * 60 * 1000)).toISOString(),
    }));
    const service = TestBed.inject(DocumentGenerationService);
    const errors: unknown[] = [];

    service.generate(job, evidence).subscribe({error: error => errors.push(error)});
    await vi.advanceTimersByTimeAsync(1_500);

    expect(errors).toEqual([
      expect.objectContaining({
        code: 'OUTCOME_UNKNOWN',
        message: expect.stringContaining('still requires recovery'),
      }),
    ]);
    expect(save).not.toHaveBeenCalled();
    expect(startOperation).toHaveBeenCalledOnce();
    expect(getOperation).toHaveBeenCalledTimes(2);
    expect(service.pendingGenerations()).toEqual([
      expect.objectContaining({canonicalJobId, operationId, evidence}),
    ]);
    expect(localStorage.getItem(`jsc-document-generation-v1:${ownerId}`)).not.toBeNull();
  });

  it('reuses the original request when a start response was ambiguous before an operation id', async () => {
    writeAttempt({});
    const changedEvidence: GenerationEvidenceSelection = {
      cv: {
        entryIds: ['70000000-0000-4000-8000-000000000099'],
        sectionOrder: [DocumentEvidenceSelectionSectionOrderEnum.Project],
      },
      coverLetter: {
        entryIds: ['70000000-0000-4000-8000-000000000098'],
        sectionOrder: [DocumentEvidenceSelectionSectionOrderEnum.Education],
      },
    };

    await firstValueFrom(
      TestBed.inject(DocumentGenerationService).generate(job, changedEvidence),
    );

    expect(save).not.toHaveBeenCalled();
    expect(startOperation).toHaveBeenCalledWith(
      savedJobId,
      'browser-stable-key',
      {
        outputs: ['CV', 'COVER_LETTER'],
        documents: [
          expect.objectContaining({entryIds: evidence.cv.entryIds}),
          expect.objectContaining({entryIds: evidence.coverLetter.entryIds}),
        ],
      },
      'body',
      false,
      {transferCache: false},
    );
  });

  it('never replays an ambiguous provider outcome', async () => {
    writeAttempt({operationId});
    getOperation.mockReturnValue(of({
      operationId,
      state: 'GENERATION_OUTCOME_UNKNOWN',
      failureCode: 'GENERATION_OUTCOME_UNKNOWN',
    }));

    await expect(firstValueFrom(
      TestBed.inject(DocumentGenerationService).resume(canonicalJobId),
    )).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    expect(startOperation).not.toHaveBeenCalled();
    expect(approveOperation).not.toHaveBeenCalled();
    expect(TestBed.inject(DocumentGenerationService).pendingGenerations()).toHaveLength(1);
  });

  it('explains when a complete job advert must be confirmed before generation', async () => {
    writeAttempt({operationId});
    getOperation.mockReturnValue(of({
      operationId,
      state: 'FAILED',
      failureCode: 'JOB_DESCRIPTION_REVIEW_REQUIRED',
    }));

    await expect(firstValueFrom(
      TestBed.inject(DocumentGenerationService).resume(canonicalJobId),
    )).rejects.toMatchObject({
      code: 'DESCRIPTION_REQUIRED',
      message: expect.stringContaining('No AI credit was used'),
    });
  });

  it('cancels by operation id and retains no resumable operation', async () => {
    writeAttempt({operationId});
    const service = TestBed.inject(DocumentGenerationService);

    await firstValueFrom(service.cancel(canonicalJobId));

    expect(ensureCsrf).toHaveBeenCalled();
    expect(cancelOperation).toHaveBeenCalledWith(
      operationId,
      'body',
      false,
      {transferCache: false},
    );
    expect(service.pendingGenerations()).toEqual([]);
  });

  it('retains pending recovery when cancellation conflicts with authoritative state', async () => {
    writeAttempt({operationId});
    cancelOperation.mockReturnValue(throwError(() => ({
      status: 409,
      error: {error: 'GENERATION_CONFLICT'},
    })));
    const service = TestBed.inject(DocumentGenerationService);

    await expect(firstValueFrom(service.cancel(canonicalJobId))).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
      message: expect.stringContaining('Refresh'),
    });
    expect(service.pendingGenerations()).toHaveLength(1);
  });

  it('retains a start attempt when no authoritative cancellation id exists yet', async () => {
    writeAttempt({});
    const service = TestBed.inject(DocumentGenerationService);

    await expect(firstValueFrom(service.cancel(canonicalJobId))).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    expect(cancelOperation).not.toHaveBeenCalled();
    expect(service.pendingGenerations()).toHaveLength(1);
  });

  it('completes an active monitor on confirmed cancellation without a late result', async () => {
    const operationStates = new Subject<GenerationOperationResponse>();
    getOperation.mockReturnValue(operationStates);
    const service = TestBed.inject(DocumentGenerationService);
    const next = vi.fn();
    const error = vi.fn();
    const complete = vi.fn();
    service.generate(job, evidence).subscribe({next, error, complete});
    operationStates.next({
      operationId,
      state: GenerationOperationResponseStateEnum.GenerationInProgress,
      replaySafe: true,
    });

    await firstValueFrom(service.cancel(canonicalJobId));
    operationStates.next(completedOperation());

    expect(complete).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('keeps persisted attempts isolated between logical owner sessions', () => {
    writeAttempt({operationId});
    const service = TestBed.inject(DocumentGenerationService);
    expect(service.pendingGenerations()).toHaveLength(1);

    currentOwnerId = '10000000-0000-4000-8000-000000000002';
    expect(service.pendingGenerations()).toEqual([]);

    currentOwnerId = ownerId;
    expect(service.pendingGenerations()).toHaveLength(1);
  });

  it('hides expired persisted attempts without deleting their explicit-retry evidence', () => {
    writeAttempt({
      operationId,
      startedAt: Date.now() - (11 * 60 * 1000),
    });
    const service = TestBed.inject(DocumentGenerationService);

    expect(service.pendingGenerations()).toEqual([]);
    expect(localStorage.getItem(`jsc-document-generation-v1:${ownerId}`)).not.toBeNull();
    expect(getOperation).not.toHaveBeenCalled();
  });

  it('reports HTTP 202 replacement as processing instead of optimistic success', async () => {
    httpPost.mockReturnValue(of({
      status: 202,
      body: {
        operationId,
        operationStatus: 'PROCESSING',
      },
    }));
    const file = new File(['safe'], 'replacement.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    const response = await TestBed.inject(DocumentGenerationService)
      .uploadReplacement(applicationId, file, 'CV');

    expect(response.processing).toBe(true);
    expect(httpPost).toHaveBeenCalledWith(
      `/api/v1/document-generation/applications/${applicationId}/replace?documentType=CV`,
      expect.any(FormData),
      {observe: 'response'},
    );
  });

  it('generates and approves only the explicitly selected CV output', async () => {
    getOperation.mockReturnValue(of({
      operationId,
      state: GenerationOperationResponseStateEnum.AwaitingApproval,
      cvDocumentId,
    }));
    approveOperation.mockReturnValue(of({
      operationId,
      state: GenerationOperationResponseStateEnum.Completed,
      applicationId,
      cvDocumentId,
      downloads: {},
    }));

    const result = await firstValueFrom(
      TestBed.inject(DocumentGenerationService).generate(job, evidence, ['CV']),
    );

    expect(result).toEqual({
      applicationId,
      cvDocumentId,
      downloads: {cv: {}, coverLetter: {}},
    });
    expect(startOperation).toHaveBeenCalledWith(
      savedJobId,
      expect.stringMatching(/^browser-/),
      {
        outputs: ['CV'],
        documents: [{
          purpose: DocumentEvidenceSelectionPurposeEnum.Cv,
          entryIds: evidence.cv.entryIds,
          sectionOrder: evidence.cv.sectionOrder,
        }],
      },
      'body',
      false,
      {transferCache: false},
    );
    expect(approveOperation).toHaveBeenCalledWith(
      operationId,
      {cvDocumentId},
      'body',
      false,
      {transferCache: false},
    );
  });

  it('reports byte upload separately from server checking and completion', async () => {
    const file = new File(['safe-pdf'], 'existing-cv.pdf', {type: 'application/pdf'});
    uploadApplicationDocument.mockReturnValue(of(
      {type: HttpEventType.UploadProgress, loaded: file.size, total: file.size},
      new HttpResponse({
        status: 200,
        body: {
          operationId,
          applicationId,
          jobId: canonicalJobId,
          documentType: 'CV',
          fileType: 'PDF',
          state: 'COMPLETED',
          documentId: cvDocumentId,
        },
      }),
    ));
    const progress = vi.fn();

    const operation = await firstValueFrom(
      TestBed.inject(DocumentGenerationService).uploadApplicationDocument({
        applicationId,
        jobId: canonicalJobId,
        documentType: 'CV',
        file,
        idempotencyKey: 'browser-upload-stable',
      }, progress),
    );

    expect(operation.state).toBe('COMPLETED');
    expect(uploadApplicationDocument).toHaveBeenCalledWith(
      applicationId,
      canonicalJobId,
      'CV',
      'PDF',
      'browser-upload-stable',
      file,
      'events',
      true,
      {transferCache: false},
    );
    expect(progress.mock.calls.map(([value]) => value.phase)).toEqual([
      'UPLOADING',
      'UPLOADING',
      'CHECKING',
      'COMPLETED',
    ]);
    expect(getApplicationDocumentUpload).not.toHaveBeenCalled();
  });

  it('polls a linking upload by exact operation identity without re-uploading bytes', async () => {
    vi.useFakeTimers();
    const file = new File(['safe-docx'], 'letter.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    uploadApplicationDocument.mockReturnValue(of(new HttpResponse({
      status: 202,
      body: {
        operationId,
        applicationId,
        jobId: canonicalJobId,
        documentType: 'COVER_LETTER',
        fileType: 'DOCX',
        state: 'LINKING',
      },
    })));
    getApplicationDocumentUpload.mockReturnValue(of({
      operationId,
      applicationId,
      jobId: canonicalJobId,
      documentType: 'COVER_LETTER',
      fileType: 'DOCX',
      state: 'COMPLETED',
      documentId: coverLetterDocumentId,
    }));
    const progress = vi.fn();

    const result = firstValueFrom(
      TestBed.inject(DocumentGenerationService).uploadApplicationDocument({
        applicationId,
        jobId: canonicalJobId,
        documentType: 'COVER_LETTER',
        file,
        idempotencyKey: 'browser-upload-letter',
      }, progress),
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(result).resolves.toMatchObject({state: 'COMPLETED'});
    expect(uploadApplicationDocument).toHaveBeenCalledOnce();
    expect(getApplicationDocumentUpload).toHaveBeenCalledWith(
      operationId,
      'body',
      false,
      {transferCache: false},
    );
    expect(progress.mock.calls.map(([value]) => value.phase)).toContain('LINKING');
  });

  it('rejects a file over 10 MiB before any upload request', () => {
    const file = new File([new Uint8Array((10 * 1024 * 1024) + 1)], 'large.pdf', {
      type: 'application/pdf',
    });

    expect(() => TestBed.inject(DocumentGenerationService).uploadApplicationDocument({
      applicationId,
      jobId: canonicalJobId,
      documentType: 'CV',
      file,
      idempotencyKey: 'browser-upload-large',
    }, vi.fn())).toThrow('The document must be between 1 byte and 10 MiB.');
    expect(uploadApplicationDocument).not.toHaveBeenCalled();
  });

  function completedOperation(): GenerationOperationResponse {
    return {
      operationId,
      state: GenerationOperationResponseStateEnum.Completed,
      applicationId,
      cvDocumentId,
      coverLetterDocumentId,
      downloads: {},
    };
  }

  function writeAttempt(overrides: {
    operationId?: string;
    startedAt?: number;
  }): void {
    localStorage.setItem(`jsc-document-generation-v1:${ownerId}`, JSON.stringify([{
      version: 1,
      canonicalJobId,
      savedJobId,
      operationId: overrides.operationId,
      idempotencyKey: 'browser-stable-key',
      startedAt: overrides.startedAt ?? Date.now(),
      evidence,
    }]));
  }
});
