import {HttpClient} from '@angular/common/http';
import {TestBed} from '@angular/core/testing';
import {firstValueFrom, of, Subject, throwError} from 'rxjs';
import {
  DocumentEvidenceSelectionPurposeEnum,
  DocumentEvidenceSelectionSectionOrderEnum,
  DocumentGenerationControllerService,
  GenerationOperationResponse,
  GenerationOperationResponseStateEnum,
} from '../api/document-generation-gateway';
import {SavedJobsService} from '../api/job-finder';
import {Job} from '../models/job-search.model';
import {BrowserSessionService} from './browser-session.service';
import {
  DocumentGenerationService,
  GenerationEvidenceSelection,
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
        {provide: HttpClient, useValue: {post: httpPost}},
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
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

  function writeAttempt(overrides: {operationId?: string}): void {
    localStorage.setItem(`jsc-document-generation-v1:${ownerId}`, JSON.stringify([{
      version: 1,
      canonicalJobId,
      savedJobId,
      operationId: overrides.operationId,
      idempotencyKey: 'browser-stable-key',
      startedAt: Date.now(),
      evidence,
    }]));
  }
});
