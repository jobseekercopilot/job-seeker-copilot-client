import { HttpClient, HttpEventType, HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  catchError,
  defer,
  EMPTY,
  expand,
  filter,
  finalize,
  firstValueFrom,
  from,
  map,
  Observable,
  shareReplay,
  Subject,
  switchMap,
  take,
  takeUntil,
  tap,
  throwError,
  timer,
  timeout,
} from 'rxjs';
import { Job } from '../models/job-search.model';
import {
  DocumentDownloadsResponse,
  DocumentEvidenceSelectionPurposeEnum,
  DocumentEvidenceSelectionSectionOrderEnum,
  DocumentGenerationControllerService,
  ApplicationDocumentUploadControllerService,
  ApplicationDocumentUploadOperationResponse,
  ApplicationDocumentUploadOperationResponseStateEnum,
  DownloadFileResponse,
  GenerationOperationResponse,
  GenerationOperationResponseStateEnum,
  StartGenerationRequestOutputsEnum,
} from '../api/document-generation-gateway';
import {
  Job as SavedJob,
  SavedJobsService,
} from '../api/job-finder';
import { BrowserSessionService } from './browser-session.service';

export type DocumentKind = 'CV' | 'COVER_LETTER';
export type UploadFormat = 'DOCX' | 'PDF';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERATION_SOURCES = new Set<GenerationSource>([
  'LLM',
  'DETERMINISTIC_FALLBACK',
  'NOT_AVAILABLE',
]);
const BILLING_STATUSES = new Set<BillingStatus>([
  'NOT_RESERVED',
  'RESERVED',
  'COMMITTED',
  'RELEASED_NO_CHARGE',
  'RELEASED_AFTER_FAILURE',
  'RESERVED_PENDING_RECONCILIATION',
  'RELEASED_AFTER_RECONCILIATION',
]);

export interface DocumentArtifactManifestItem {
  artifactId: string;
  role: 'ORIGINAL' | 'DERIVED';
  format: UploadFormat;
  source: string;
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  size: number;
  storedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export function documentArtifactDownloadLabel(
  artifact: DocumentArtifactManifestItem,
): string | undefined {
  if (artifact.availability !== 'AVAILABLE') return undefined;
  if (artifact.role === 'ORIGINAL') return 'Download original';
  if (artifact.role !== 'DERIVED') return undefined;
  if (artifact.format === 'DOCX') return 'Download DOCX';
  if (artifact.format === 'PDF') return 'Download PDF';
  return undefined;
}

export interface GenerationEvidenceSelection {
  cv: {
    entryIds: string[];
    sectionOrder: DocumentEvidenceSelectionSectionOrderEnum[];
  };
  coverLetter: {
    entryIds: string[];
    sectionOrder: DocumentEvidenceSelectionSectionOrderEnum[];
  };
}

export type ApplicationDocumentUploadPhase =
  | 'UPLOADING'
  | 'CHECKING'
  | 'LINKING'
  | 'COMPLETED'
  | 'ERROR';

export interface ApplicationDocumentUploadProgress {
  phase: ApplicationDocumentUploadPhase;
  loadedBytes?: number;
  totalBytes?: number;
  percent?: number;
  state?: ApplicationDocumentUploadOperationResponse['state'];
}

export interface ApplicationDocumentUploadRequest {
  applicationId: string;
  jobId: string;
  documentType: DocumentKind;
  file: File;
  idempotencyKey: string;
}

export interface DocumentUploadResponse {
  generatedDocumentId?: string;
  applicationId?: string;
  cvDocumentId?: string;
  coverLetterDocumentId?: string;
  version?: number;
  uploadedFile?: DownloadFileResponse;
  regeneratedFiles?: DownloadFileResponse[];
  latestFiles?: DocumentDownloadsResponse;
  operationId?: string;
  operationStatus?: string;
  retryable?: boolean;
  recoveryCode?: string;
  message?: string;
  processing: boolean;
}

export interface GeneratedApplicationWithdrawal {
  processing: boolean;
  retryable?: boolean;
  recoveryCode?: string;
  message?: string;
}

export interface DocumentFileMetadata {
  id?: string;
  generatedDocumentId?: string;
  fileType?: 'DOCX' | 'PDF';
  fileName?: string;
  mimeType?: string;
  source?: 'SYSTEM_GENERATED' | 'USER_UPLOADED' | string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
  sizeBytes?: number;
  fileSize?: number;
}

export interface GenerationDownloadsResponse {
  cv?: DocumentDownloadsResponse;
  coverLetter?: DocumentDownloadsResponse;
}

export type GenerationSource = 'LLM' | 'DETERMINISTIC_FALLBACK' | 'NOT_AVAILABLE';
export type BillingStatus =
  | 'NOT_RESERVED'
  | 'RESERVED'
  | 'COMMITTED'
  | 'RELEASED_NO_CHARGE'
  | 'RELEASED_AFTER_FAILURE'
  | 'RESERVED_PENDING_RECONCILIATION'
  | 'RELEASED_AFTER_RECONCILIATION';

export interface DocumentRecoverySummary {
  generationSource: GenerationSource;
  structuralRepairStatus: 'APPLIED' | 'CHECKED' | 'NOT_REQUIRED';
  duplicateItemsRemoved: number;
  providerAttemptCount: number;
  automaticRetryCount: number;
  retried: boolean;
  retryReason?: 'RATE_LIMITED';
  retainedResponseReplayed: boolean;
  deterministicFallbackUsed: boolean;
  fallbackReason?:
    | 'PROVIDER_FAILURE'
    | 'EMPTY_PROVIDER_RESPONSE'
    | 'RECONCILIATION_EXHAUSTED'
    | 'MODEL_OUTPUT_REJECTED'
    | 'RETAINED_MODEL_OUTPUT_REJECTED';
  reconciliationStatus: 'NOT_REQUIRED' | 'PENDING' | 'RECOVERED' | 'EXHAUSTED';
  reconciliationAttempts: number;
  reconciliationSource?: 'RETAINED_RESPONSE' | 'DETERMINISTIC_FALLBACK';
  billingStatus: BillingStatus;
  charged: boolean;
  released: boolean;
}

export interface DocumentGenerationResponse {
  applicationId: string;
  cvDocumentId?: string;
  coverLetterDocumentId?: string;
  downloads: GenerationDownloadsResponse;
  recovery?: Partial<Record<DocumentKind, DocumentRecoverySummary>>;
}

export type DocumentGenerationErrorCode =
  | 'AUTH_REQUIRED'
  | 'CANCELLED'
  | 'DISABLED'
  | 'DESCRIPTION_REQUIRED'
  | 'EVIDENCE_CHANGED'
  | 'FAILED'
  | 'OUTCOME_UNKNOWN'
  | 'QUOTA_EXHAUSTED'
  | 'RATE_LIMITED'
  | 'TIMEOUT';

export class DocumentGenerationError extends Error {
  constructor(
    readonly code: DocumentGenerationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentGenerationError';
  }
}

export interface PendingDocumentGeneration {
  canonicalJobId: string;
  operationId?: string;
  state: 'PROCESSING';
  startedAt: number;
  evidence: GenerationEvidenceSelection;
  outputs?: DocumentKind[];
}

interface StoredGenerationAttempt {
  version: 1;
  canonicalJobId: string;
  idempotencyKey: string;
  savedJobId?: string;
  operationId?: string;
  approvalRequested?: boolean;
  startedAt: number;
  evidence: GenerationEvidenceSelection;
  outputs?: DocumentKind[];
}

@Injectable({ providedIn: 'root' })
export class DocumentGenerationService {
  private static readonly ATTEMPT_STORAGE_PREFIX = 'jsc-document-generation-v1:';
  private static readonly MAXIMUM_OPERATION_AGE_MS = 11 * 60 * 1000;
  private static readonly DEADLINE_TRANSPORT_MARGIN_MS = 15_000;
  private static readonly POLL_INTERVAL_MS = 1_500;
  private static readonly OPERATION_STATUS_TIMEOUT_MS = 75_000;
  private readonly api = inject(DocumentGenerationControllerService);
  private readonly applicationUploads = inject(ApplicationDocumentUploadControllerService);
  private readonly savedJobs = inject(SavedJobsService);
  private readonly browserSession = inject(BrowserSessionService);
  private readonly http = inject(HttpClient);
  private readonly memoryAttempts = new Map<string, StoredGenerationAttempt>();
  private readonly activeGenerations = new Map<string, Observable<DocumentGenerationResponse>>();
  private readonly cancellationSignals = new Map<string, Subject<void>>();

  generate(
    job: Job,
    evidence: GenerationEvidenceSelection,
    outputs: DocumentKind[] = ['CV', 'COVER_LETTER'],
  ): Observable<DocumentGenerationResponse> {
    const canonicalJobId = job.canonicalJobId ?? job.id;
    if (!canonicalJobId || !job.title || !job.company || !job.description) {
      throw new Error('The selected job does not contain the data required for generation.');
    }
    if (!this.validRequestedOutputs(outputs)) {
      throw new Error('Choose at least one document type to generate.');
    }
    if (outputs.some(output => {
      const selected = output === 'CV' ? evidence.cv : evidence.coverLetter;
      return !selected.entryIds.length || !selected.sectionOrder.length;
    })) {
      throw new Error('Choose entries confirmed by you for every requested document.');
    }

    const active = this.activeGenerations.get(canonicalJobId);
    if (active) return active;

    const attempt = this.readAttempt(canonicalJobId) ?? {
      version: 1,
      canonicalJobId,
      idempotencyKey: `browser-${crypto.randomUUID()}`,
      startedAt: Date.now(),
      evidence: this.copyEvidence(evidence),
      outputs: [...outputs],
    } satisfies StoredGenerationAttempt;
    if (!attempt.operationId) attempt.outputs = [...outputs];
    this.writeAttempt(attempt);
    const cancellation = new Subject<void>();
    this.cancellationSignals.set(canonicalJobId, cancellation);

    // Re-bootstrap immediately before this multi-step write workflow. A browser
    // can retain the in-memory token after its matching cookie has been cleared,
    // and blindly reusing that token causes the initial saved-job write to fail.
    const request = defer(() => attempt.operationId
      ? this.monitorAttempt(attempt, true)
      : attempt.savedJobId
        ? this.restartAttempt(attempt)
        : this.startAttempt(job, evidence, attempt)).pipe(
      catchError(error => throwError(() => this.generationError(error))),
      takeUntil(cancellation),
      finalize(() => {
        if (this.activeGenerations.get(canonicalJobId) === request) {
          this.activeGenerations.delete(canonicalJobId);
        }
        if (this.cancellationSignals.get(canonicalJobId) === cancellation) {
          this.cancellationSignals.delete(canonicalJobId);
        }
      }),
      shareReplay({bufferSize: 1, refCount: false}),
    );
    this.activeGenerations.set(canonicalJobId, request);
    return request;
  }

  pendingGenerations(): PendingDocumentGeneration[] {
    return this.readAttempts().map(attempt => ({
      canonicalJobId: attempt.canonicalJobId,
      operationId: attempt.operationId,
      state: 'PROCESSING',
      startedAt: attempt.startedAt,
      evidence: this.copyEvidence(attempt.evidence),
      outputs: this.attemptOutputs(attempt),
    }));
  }

  resume(canonicalJobId: string): Observable<DocumentGenerationResponse> {
    const active = this.activeGenerations.get(canonicalJobId);
    if (active) return active;
    const attempt = this.readAttempt(canonicalJobId);
    if (!attempt) {
      return throwError(() => new DocumentGenerationError(
        'OUTCOME_UNKNOWN',
        'Generation could not be restored safely. Review your evidence and retry.',
      ));
    }
    const cancellation = new Subject<void>();
    this.cancellationSignals.set(canonicalJobId, cancellation);

    const request = (
      attempt.operationId
        ? this.monitorAttempt(attempt, true)
        : this.restartAttempt(attempt)
    ).pipe(
      catchError(error => throwError(() => this.generationError(error))),
      takeUntil(cancellation),
      finalize(() => {
        if (this.activeGenerations.get(canonicalJobId) === request) {
          this.activeGenerations.delete(canonicalJobId);
        }
        if (this.cancellationSignals.get(canonicalJobId) === cancellation) {
          this.cancellationSignals.delete(canonicalJobId);
        }
      }),
      shareReplay({bufferSize: 1, refCount: false}),
    );
    this.activeGenerations.set(canonicalJobId, request);
    return request;
  }

  cancel(canonicalJobId: string): Observable<void> {
    const attempt = this.readAttempt(canonicalJobId);
    if (!attempt?.operationId) {
      return throwError(() => new DocumentGenerationError(
        'OUTCOME_UNKNOWN',
        'The generation operation has not supplied a safe cancellation reference.',
      ));
    }

    return this.browserSession.ensureCsrf().pipe(
      switchMap(() => this.api.cancelOperation(
        attempt.operationId as string,
        'body',
        false,
        {transferCache: false},
      )),
      map(operation => {
        if (operation.state !== GenerationOperationResponseStateEnum.Cancelled) {
          throw this.operationError(operation);
        }
        this.clearAttempt(canonicalJobId);
        const cancellation = this.cancellationSignals.get(canonicalJobId);
        cancellation?.next();
        cancellation?.complete();
        if (this.cancellationSignals.get(canonicalJobId) === cancellation) {
          this.cancellationSignals.delete(canonicalJobId);
        }
        this.activeGenerations.delete(canonicalJobId);
      }),
      catchError(error => throwError(() => this.generationError(error))),
    );
  }

  private startAttempt(
    job: Job,
    evidence: GenerationEvidenceSelection,
    attempt: StoredGenerationAttempt,
  ): Observable<DocumentGenerationResponse> {
    return this.browserSession.refreshCsrf().pipe(
      switchMap(() => this.savedJobs.save(
        this.canonicalJobSnapshot(job),
        'body',
        false,
        {transferCache: false},
      )),
      switchMap(savedJob => {
        if (!savedJob.savedJobId) {
          throw new DocumentGenerationError(
            'FAILED',
            'The selected job could not be saved for document generation.',
          );
        }
        attempt.savedJobId = savedJob.savedJobId;
        attempt.evidence = this.copyEvidence(evidence);
        this.writeAttempt(attempt);
        return this.startOperation(attempt);
      }),
      switchMap(operation => {
        this.acceptOperation(attempt, operation);
        // This POST was acknowledged, so poll its operation instead of immediately
        // replaying it. Replay remains available when restoring a persisted attempt.
        return this.monitorAttempt(attempt, false);
      }),
    );
  }

  private canonicalJobSnapshot(job: Job): SavedJob {
    const snapshot = {...job} as SavedJob;
    delete snapshot.matchScore;
    delete snapshot.distanceMiles;
    delete snapshot.applicationStatus;
    delete snapshot.applicationId;
    delete snapshot.cvDocumentId;
    delete snapshot.coverLetterDocumentId;
    delete snapshot.appliedAt;
    delete snapshot.applicationUpdatedAt;
    return snapshot;
  }

  private restartAttempt(
    attempt: StoredGenerationAttempt,
  ): Observable<DocumentGenerationResponse> {
    if (!attempt.savedJobId) {
      return throwError(() => new DocumentGenerationError(
        'OUTCOME_UNKNOWN',
        'Generation could not be restored safely. Review your evidence and retry.',
      ));
    }
    return this.browserSession.ensureCsrf().pipe(
      switchMap(() => this.startOperation(attempt)),
      switchMap(operation => {
        this.acceptOperation(attempt, operation);
        return this.monitorAttempt(attempt, false);
      }),
    );
  }

  private startOperation(
    attempt: StoredGenerationAttempt,
  ): Observable<GenerationOperationResponse> {
    if (!attempt.savedJobId) {
      return throwError(() => new DocumentGenerationError(
        'OUTCOME_UNKNOWN',
        'The saved job reference required to resume generation is missing.',
      ));
    }
    const outputs = this.attemptOutputs(attempt);
    const documents = outputs.map(output => {
      const selection = output === 'CV'
        ? attempt.evidence.cv
        : attempt.evidence.coverLetter;
      return {
        purpose: output === 'CV'
          ? DocumentEvidenceSelectionPurposeEnum.Cv
          : DocumentEvidenceSelectionPurposeEnum.CoverLetter,
        entryIds: [...selection.entryIds],
        sectionOrder: [...selection.sectionOrder],
      };
    });
    const serializableOutputs = outputs.map(output => output === 'CV'
      ? StartGenerationRequestOutputsEnum.Cv
      : StartGenerationRequestOutputsEnum.CoverLetter);
    return this.api.startOperation(
      attempt.savedJobId,
      attempt.idempotencyKey,
      {
        // OpenAPI Generator models unique arrays as Set<T>, but Angular's JSON
        // encoder serializes a native Set as {}. Keep the generated type at the
        // boundary while sending the JSON array required by the wire contract.
        outputs: serializableOutputs as unknown as Set<StartGenerationRequestOutputsEnum>,
        documents,
      },
      'body',
      false,
      {transferCache: false},
    );
  }

  private monitorAttempt(
    attempt: StoredGenerationAttempt,
    safeStartReplay: boolean,
  ): Observable<DocumentGenerationResponse> {
    if (!attempt.operationId) {
      return throwError(() => new DocumentGenerationError(
        'OUTCOME_UNKNOWN',
        'The generation operation reference is missing.',
      ));
    }

    let approvalAvailable = true;
    let replayAvailable = Boolean(attempt.savedJobId);
    let replayAttempted = false;
    let replayAcknowledgementPending = false;
    let observedDeadline = attempt.startedAt
      + DocumentGenerationService.MAXIMUM_OPERATION_AGE_MS;

    return this.getOperation(
      attempt,
      safeStartReplay ? undefined : () => observedDeadline,
    ).pipe(
      expand(operation => {
        const operationDeadline = this.operationDeadline(operation);
        if (replayAcknowledgementPending && operationDeadline !== undefined) {
          observedDeadline = operationDeadline;
        } else {
          observedDeadline = Math.min(
            observedDeadline,
            operationDeadline ?? observedDeadline,
          );
        }

        const deadlineRecoveryRequired = this.isDeadlineRecoveryRequired(operation);
        if (deadlineRecoveryRequired) {
          if (replayAcknowledgementPending) {
            replayAcknowledgementPending = false;
            return this.pollOperation(attempt, () => observedDeadline);
          }
          if (replayAttempted) {
            return throwError(() => new DocumentGenerationError(
              'OUTCOME_UNKNOWN',
              'Document generation still requires recovery after a safe replay. Try again later to resume the same operation; no duplicate AI request will be made.',
            ));
          }
          if (replayAvailable) {
            replayAvailable = false;
            replayAttempted = true;
            replayAcknowledgementPending = true;
            return this.browserSession.ensureCsrf().pipe(
              switchMap(() => this.startOperation(attempt)),
            );
          }
          return throwError(() => new DocumentGenerationError(
            'OUTCOME_UNKNOWN',
            'Document generation requires recovery, but its original saved request is unavailable. Review your evidence before trying again.',
          ));
        }

        const preProviderDeadlineExpired = this.isPreProviderDeadlineExpired(operation);
        if (preProviderDeadlineExpired) {
          if (replayAttempted) {
            return throwError(() => new DocumentGenerationError(
              'TIMEOUT',
              'Document generation could not restart after its deadline. Your evidence selection has been kept.',
            ));
          }
          if (replayAvailable && operation.replaySafe === true) {
            replayAvailable = false;
            replayAttempted = true;
            replayAcknowledgementPending = true;
            return this.browserSession.ensureCsrf().pipe(
              switchMap(() => this.startOperation(attempt)),
            );
          }
          return throwError(() => new DocumentGenerationError(
            'TIMEOUT',
            'Document generation expired before the AI request started, but the gateway did not confirm that replay is safe. Your evidence selection has been kept.',
          ));
        }

        if (this.isTerminal(operation.state)) return EMPTY;

        const downstreamRetryable = this.isDownstreamRetryable(operation);
        if (replayAcknowledgementPending) {
          replayAcknowledgementPending = false;
          if (downstreamRetryable) {
            return this.pollOperation(attempt, () => observedDeadline);
          }
        } else if (replayAttempted && downstreamRetryable) {
          return throwError(() => new DocumentGenerationError(
            'FAILED',
            'Document generation could not complete a recovery step. Try again to resume the same operation safely; no duplicate AI request will be made.',
          ));
        }

        if (
          replayAvailable
          && operation.replaySafe !== false
          && this.isSafePreProviderState(operation.state)
          && (safeStartReplay || downstreamRetryable)
        ) {
          replayAvailable = false;
          replayAttempted = true;
          replayAcknowledgementPending = true;
          return this.browserSession.ensureCsrf().pipe(
            switchMap(() => this.startOperation(attempt)),
          );
        }
        if (Date.now() >= observedDeadline) {
          return this.expireAttempt();
        }
        if (
          approvalAvailable
          && this.isApprovalRecoveryState(operation.state)
        ) {
          const outputs = this.attemptOutputs(attempt);
          if (!operation.cvDocumentId && !operation.coverLetterDocumentId) {
            return throwError(() => new DocumentGenerationError(
              'FAILED',
              'Document generation produced no documents. Your evidence is kept.',
            ));
          }
          approvalAvailable = false;
          attempt.approvalRequested = true;
          this.writeAttempt(attempt);
          return this.browserSession.ensureCsrf().pipe(
            switchMap(() => this.api.approveOperation(
              attempt.operationId as string,
              {
                ...(outputs.includes('CV')
                  ? {cvDocumentId: operation.cvDocumentId as string}
                  : {}),
                ...(outputs.includes('COVER_LETTER')
                  ? {coverLetterDocumentId: operation.coverLetterDocumentId as string}
                  : {}),
              },
              'body',
              false,
              {transferCache: false},
            )),
          );
        }
        return this.pollOperation(attempt, () => observedDeadline);
      }),
      tap(operation => this.acceptOperation(attempt, operation)),
      filter(operation =>
        this.isTerminal(operation.state)
        && !this.isDeadlineRecoveryRequired(operation)
        && !this.isPreProviderDeadlineExpired(operation)),
      take(1),
      map(operation => {
        if (operation.state !== GenerationOperationResponseStateEnum.Completed) {
          if (!this.shouldRetainAttempt(operation)) {
            this.clearAttempt(attempt.canonicalJobId);
          }
          throw this.operationError(operation);
        }
        const completed = this.completedGeneration(operation, this.attemptOutputs(attempt));
        this.clearAttempt(attempt.canonicalJobId);
        return completed;
      }),
    );
  }

  private pollOperation(
    attempt: StoredGenerationAttempt,
    deadline: () => number,
  ): Observable<GenerationOperationResponse> {
    const delay = Math.min(
      DocumentGenerationService.POLL_INTERVAL_MS,
      Math.max(0, deadline() - Date.now()),
    );
    return timer(delay).pipe(
      switchMap(() => this.getOperation(attempt, deadline)),
    );
  }

  private getOperation(
    attempt: StoredGenerationAttempt,
    deadline?: () => number,
  ): Observable<GenerationOperationResponse> {
    return defer(() => {
      const remaining = deadline
        ? deadline() - Date.now()
        : DocumentGenerationService.OPERATION_STATUS_TIMEOUT_MS;
      if (remaining <= 0) return this.expireAttempt();

      return this.api.getOperation(
        attempt.operationId as string,
        'body',
        false,
        {transferCache: false},
      ).pipe(
        timeout({
          first: Math.min(
            DocumentGenerationService.OPERATION_STATUS_TIMEOUT_MS,
            remaining,
          ),
          with: () => deadline && Date.now() >= deadline()
            ? this.expireAttempt()
            : throwError(() => new DocumentGenerationError(
                'TIMEOUT',
                'Document generation status could not be refreshed. Check your connection and try again; the same operation can be resumed safely.',
              )),
        }),
      );
    });
  }

  private expireAttempt(): Observable<never> {
    return throwError(() => new DocumentGenerationError(
      'TIMEOUT',
      'Document generation did not finish before its deadline. Try again to resume the same operation safely.',
    ));
  }

  private acceptOperation(
    attempt: StoredGenerationAttempt,
    operation: GenerationOperationResponse,
  ): void {
    if (!operation.operationId) {
      throw new DocumentGenerationError(
        'FAILED',
        'The document service returned an invalid generation operation.',
      );
    }
    if (attempt.operationId && attempt.operationId !== operation.operationId) {
      throw new DocumentGenerationError(
        'OUTCOME_UNKNOWN',
        'The generation operation identity changed unexpectedly.',
      );
    }
    attempt.operationId = operation.operationId;
    this.writeAttempt(attempt);
  }

  private isSafePreProviderState(
    state: GenerationOperationResponse['state'],
  ): boolean {
    return [
      GenerationOperationResponseStateEnum.Created,
      GenerationOperationResponseStateEnum.SnapshotsResolved,
      GenerationOperationResponseStateEnum.ApplicationSaved,
      GenerationOperationResponseStateEnum.OutputReady,
      GenerationOperationResponseStateEnum.Estimated,
      GenerationOperationResponseStateEnum.AllowanceReserved,
      GenerationOperationResponseStateEnum.DraftGenerated,
      GenerationOperationResponseStateEnum.AllowanceCommitted,
      GenerationOperationResponseStateEnum.DraftsStored,
    ].includes(state as GenerationOperationResponseStateEnum);
  }

  private isDownstreamRetryable(
    operation: GenerationOperationResponse,
  ): boolean {
    return operation.failureCode?.trim().toUpperCase() === 'DOWNSTREAM_RETRYABLE';
  }

  private isDeadlineRecoveryRequired(
    operation: GenerationOperationResponse,
  ): boolean {
    return operation.state === GenerationOperationResponseStateEnum.RecoveryRequired
      && operation.failureCode?.trim().toUpperCase()
        === 'OPERATION_DEADLINE_RECOVERY_REQUIRED';
  }

  private isPreProviderDeadlineExpired(
    operation: GenerationOperationResponse,
  ): boolean {
    return operation.state === GenerationOperationResponseStateEnum.Failed
      && operation.failureCode?.trim().toUpperCase()
        === 'OPERATION_DEADLINE_EXCEEDED';
  }

  private shouldRetainAttempt(
    operation: GenerationOperationResponse,
  ): boolean {
    return operation.state === GenerationOperationResponseStateEnum.GenerationOutcomeUnknown
      || operation.state === GenerationOperationResponseStateEnum.RecoveryRequired;
  }

  private isApprovalRecoveryState(
    state: GenerationOperationResponse['state'],
  ): boolean {
    return [
      GenerationOperationResponseStateEnum.AwaitingApproval,
      GenerationOperationResponseStateEnum.Approved,
      GenerationOperationResponseStateEnum.CvExportInProgress,
      GenerationOperationResponseStateEnum.CvExported,
      GenerationOperationResponseStateEnum.CoverLetterExportInProgress,
      GenerationOperationResponseStateEnum.Exported,
    ].includes(state as GenerationOperationResponseStateEnum);
  }

  private isTerminal(state: GenerationOperationResponse['state']): boolean {
    return [
      GenerationOperationResponseStateEnum.Completed,
      GenerationOperationResponseStateEnum.GenerationOutcomeUnknown,
      GenerationOperationResponseStateEnum.RecoveryRequired,
      GenerationOperationResponseStateEnum.Failed,
      GenerationOperationResponseStateEnum.Cancelled,
    ].includes(state as GenerationOperationResponseStateEnum);
  }

  private operationDeadline(operation: GenerationOperationResponse): number | undefined {
    if (!operation.deadlineAt) return undefined;
    const parsed = Date.parse(operation.deadlineAt);
    return Number.isNaN(parsed)
      ? undefined
      : parsed + DocumentGenerationService.DEADLINE_TRANSPORT_MARGIN_MS;
  }

  latestFiles(generatedDocumentId: string): Observable<DocumentDownloadsResponse> {
    if (!generatedDocumentId) {
      throw new Error('Generated document id is missing.');
    }

    return from(
      fetch(`/api/v1/document-generation/documents/${encodeURIComponent(generatedDocumentId)}/files/latest`)
        .then(async response => {
          if (!response.ok) {
            throw new Error(await this.errorMessage(response, 'Could not load generated document files.'));
          }
          return response.json() as Promise<DocumentDownloadsResponse>;
        })
    );
  }

  latestFileMetadata(generatedDocumentId: string): Observable<DocumentFileMetadata[]> {
    if (!generatedDocumentId) {
      throw new Error('Generated document id is missing.');
    }

    return from(
      fetch(`/api/v1/documents/${encodeURIComponent(generatedDocumentId)}/files/latest`)
        .then(async response => {
          if (!response.ok) {
            throw new Error(await this.errorMessage(response, 'Could not load generated document file metadata.'));
          }
          return response.json() as Promise<DocumentFileMetadata[]>;
        })
    );
  }

  allFileMetadata(generatedDocumentId: string): Observable<DocumentFileMetadata[]> {
    if (!generatedDocumentId) {
      throw new Error('Generated document id is missing.');
    }

    return from(
      fetch(`/api/v1/documents/${encodeURIComponent(generatedDocumentId)}/files`)
        .then(async response => {
          if (!response.ok) {
            throw new Error(await this.errorMessage(response, 'Could not load generated document file metadata.'));
          }
          return response.json() as Promise<DocumentFileMetadata[]>;
        })
    );
  }

  async deleteGeneratedDocument(generatedDocumentId: string): Promise<void> {
    if (!generatedDocumentId) {
      throw new Error('Generated document id is missing.');
    }

    await firstValueFrom(this.browserSession.ensureCsrf().pipe(
      switchMap(() => this.http.delete<void>(
        `/api/v1/documents/${encodeURIComponent(generatedDocumentId)}`,
      )),
    ));
  }

  async withdrawGeneratedApplication(
    applicationId: string,
  ): Promise<GeneratedApplicationWithdrawal> {
    if (!applicationId) {
      throw new Error('Application id is missing.');
    }

    return firstValueFrom(this.browserSession.ensureCsrf().pipe(
      switchMap(() => this.http.post<{
        retryable?: boolean;
        recoveryCode?: string;
        message?: string;
      }>(
        `/api/jobs/applications/${encodeURIComponent(applicationId)}/withdraw-generated`,
        {},
        {observe: 'response'},
      )),
      map(response => ({
        ...(response.body ?? {}),
        processing: response.status === 202,
      })),
    ));
  }

  async download(file: DownloadFileResponse): Promise<void> {
    if (!file.fileId) {
      throw new Error('Download file id is missing.');
    }

    await this.downloadFromSameOrigin(
      `/api/v1/document-generation/files/${encodeURIComponent(file.fileId)}/download`,
      file.fileName,
    );
  }

  async downloadArtifact(
    documentId: string,
    artifact: DocumentArtifactManifestItem,
  ): Promise<void> {
    if (
      !UUID.test(documentId)
      || !UUID.test(artifact.artifactId)
      || !documentArtifactDownloadLabel(artifact)
    ) {
      throw new Error('A safe available document artifact is required.');
    }

    await this.downloadFromSameOrigin(
      `/api/v1/document-generation/documents/${documentId.toLowerCase()}/artifacts/${artifact.artifactId.toLowerCase()}/download`,
    );
  }

  private async downloadFromSameOrigin(
    path: string,
    fallbackFileName?: string,
  ): Promise<void> {
    const response = await fetch(path, {method: 'GET'});

    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}.`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = this.fileNameFromDisposition(response.headers.get('content-disposition'))
      || fallbackFileName
      || 'document';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async uploadReplacement(
    applicationId: string,
    file: File,
    documentKind: DocumentKind
  ): Promise<DocumentUploadResponse> {
    if (!applicationId) {
      throw new Error('Application id is missing.');
    }
    if (!this.isDocx(file)) {
      throw new Error('Please upload a Microsoft Word .docx file.');
    }

    const formData = new FormData();
    formData.append('file', file);
    const documentType = encodeURIComponent(documentKind);

    return firstValueFrom(this.browserSession.ensureCsrf().pipe(
      switchMap(() => this.http.post<Omit<DocumentUploadResponse, 'processing'>>(
        `/api/v1/document-generation/applications/${encodeURIComponent(applicationId)}/replace?documentType=${documentType}`,
        formData,
        {observe: 'response'},
      )),
      map(response => ({
        ...(response.body ?? {}),
        processing: response.status === 202,
      })),
    ));
  }

  uploadApplicationDocument(
    request: ApplicationDocumentUploadRequest,
    onProgress: (progress: ApplicationDocumentUploadProgress) => void,
  ): Observable<ApplicationDocumentUploadOperationResponse> {
    const fileType = this.applicationUploadFileType(request.file);
    if (!UUID.test(request.applicationId)) {
      throw new Error('A valid application is required before uploading.');
    }
    if (!request.jobId.trim() || request.jobId.length > 2_048) {
      throw new Error('A valid canonical job is required before uploading.');
    }
    if (!fileType) {
      throw new Error('Choose a PDF or Microsoft Word .docx file.');
    }
    if (request.file.size < 1 || request.file.size > 10 * 1024 * 1024) {
      throw new Error('The document must be between 1 byte and 10 MiB.');
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(request.idempotencyKey)) {
      throw new Error('The upload retry identity is invalid.');
    }

    onProgress({phase: 'UPLOADING', loadedBytes: 0, totalBytes: request.file.size, percent: 0});
    return this.browserSession.ensureCsrf().pipe(
      switchMap(() => this.applicationUploads.upload(
        request.applicationId,
        request.jobId.trim(),
        request.documentType,
        fileType,
        request.idempotencyKey,
        request.file,
        'events',
        true,
        {transferCache: false},
      )),
      tap(event => {
        if (event.type === HttpEventType.UploadProgress) {
          const total = event.total ?? request.file.size;
          onProgress({
            phase: 'UPLOADING',
            loadedBytes: Math.min(event.loaded, total),
            totalBytes: total,
            percent: total > 0
              ? Math.min(100, Math.round((event.loaded / total) * 100))
              : undefined,
          });
        } else if (
          event.type === HttpEventType.ResponseHeader
          || event.type === HttpEventType.Response
        ) {
          onProgress({phase: 'CHECKING'});
        }
      }),
      filter((event): event is HttpResponse<ApplicationDocumentUploadOperationResponse> =>
        event instanceof HttpResponse),
      map(event => this.acceptApplicationUploadOperation(event.body, request)),
      switchMap(operation => this.monitorApplicationUpload(operation, request, onProgress)),
      catchError(error => {
        onProgress({phase: 'ERROR'});
        return throwError(() => error);
      }),
    );
  }

  isDocx(file: File): boolean {
    const hasDocxExtension = file.name.toLowerCase().endsWith('.docx');
    const mimeType = file.type;
    const hasAllowedMimeType = !mimeType
      || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return hasDocxExtension && hasAllowedMimeType;
  }

  private applicationUploadFileType(file: File): UploadFormat | undefined {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf') && (!file.type || file.type === 'application/pdf')) {
      return 'PDF';
    }
    return this.isDocx(file) ? 'DOCX' : undefined;
  }

  private monitorApplicationUpload(
    initial: ApplicationDocumentUploadOperationResponse,
    request: ApplicationDocumentUploadRequest,
    onProgress: (progress: ApplicationDocumentUploadProgress) => void,
  ): Observable<ApplicationDocumentUploadOperationResponse> {
    const terminal = new Set([
      ApplicationDocumentUploadOperationResponseStateEnum.Completed,
      ApplicationDocumentUploadOperationResponseStateEnum.RecoveryRequired,
      ApplicationDocumentUploadOperationResponseStateEnum.Rejected,
    ]);
    return from([initial]).pipe(
      expand(operation => terminal.has(
        operation.state as ApplicationDocumentUploadOperationResponseStateEnum,
      )
        ? EMPTY
        : timer(1_000).pipe(
            switchMap(() => this.applicationUploads.get(
              operation.operationId as string,
              'body',
              false,
              {transferCache: false},
            )),
            map(next => this.acceptApplicationUploadOperation(next, request, operation.operationId)),
          )),
      tap(operation => onProgress({
        phase: operation.state === ApplicationDocumentUploadOperationResponseStateEnum.Completed
          ? 'COMPLETED'
          : operation.state === ApplicationDocumentUploadOperationResponseStateEnum.Linking
            ? 'LINKING'
            : terminal.has(operation.state as ApplicationDocumentUploadOperationResponseStateEnum)
              ? 'ERROR'
              : 'CHECKING',
        state: operation.state,
      })),
      filter(operation => terminal.has(
        operation.state as ApplicationDocumentUploadOperationResponseStateEnum,
      )),
      take(1),
    );
  }

  private acceptApplicationUploadOperation(
    operation: ApplicationDocumentUploadOperationResponse | null | undefined,
    request: ApplicationDocumentUploadRequest,
    expectedOperationId?: string,
  ): ApplicationDocumentUploadOperationResponse {
    if (
      !operation?.operationId
      || !UUID.test(operation.operationId)
      || (expectedOperationId && operation.operationId !== expectedOperationId)
      || operation.applicationId !== request.applicationId
      || operation.jobId !== request.jobId.trim()
      || operation.documentType !== request.documentType
      || !operation.fileType
      || !operation.state
    ) {
      throw new Error('The upload service returned a mismatched operation.');
    }
    return operation;
  }

  private copyEvidence(evidence: GenerationEvidenceSelection): GenerationEvidenceSelection {
    return {
      cv: {
        entryIds: [...evidence.cv.entryIds],
        sectionOrder: [...evidence.cv.sectionOrder],
      },
      coverLetter: {
        entryIds: [...evidence.coverLetter.entryIds],
        sectionOrder: [...evidence.coverLetter.sectionOrder],
      },
    };
  }

  private validRequestedOutputs(outputs: DocumentKind[] | undefined): outputs is DocumentKind[] {
    return Boolean(outputs)
      && (outputs?.length ?? 0) >= 1
      && (outputs?.length ?? 0) <= 2
      && outputs?.every(output => output === 'CV' || output === 'COVER_LETTER') === true
      && new Set(outputs).size === outputs.length;
  }

  private attemptOutputs(attempt: StoredGenerationAttempt): DocumentKind[] {
    return this.validRequestedOutputs(attempt.outputs)
      ? [...attempt.outputs]
      : ['CV', 'COVER_LETTER'];
  }

  private ownerScope(): string | undefined {
    const userId = this.browserSession.user()?.id?.trim();
    return userId && /^[A-Za-z0-9._:-]{1,128}$/.test(userId)
      ? userId
      : undefined;
  }

  private memoryKey(canonicalJobId: string): string {
    return `${this.ownerScope() ?? 'ephemeral'}:${canonicalJobId}`;
  }

  private readAttempt(canonicalJobId: string): StoredGenerationAttempt | undefined {
    const memory = this.memoryAttempts.get(this.memoryKey(canonicalJobId));
    if (memory) return memory;
    const stored = this.readStoredAttempts()
      .find(attempt => attempt.canonicalJobId === canonicalJobId);
    if (stored) this.memoryAttempts.set(this.memoryKey(canonicalJobId), stored);
    return stored;
  }

  private readAttempts(): StoredGenerationAttempt[] {
    const ownerPrefix = `${this.ownerScope() ?? 'ephemeral'}:`;
    const attempts = new Map(
      this.readStoredAttempts().map(attempt => [attempt.canonicalJobId, attempt]),
    );
    for (const [key, attempt] of this.memoryAttempts) {
      if (key.startsWith(ownerPrefix)) attempts.set(attempt.canonicalJobId, attempt);
    }
    const active: StoredGenerationAttempt[] = [];
    for (const attempt of attempts.values()) {
      if (!this.attemptExpired(attempt)) {
        active.push(attempt);
      }
    }
    return active;
  }

  private attemptExpired(
    attempt: StoredGenerationAttempt,
    now = Date.now(),
  ): boolean {
    return attempt.startedAt > now + DocumentGenerationService.DEADLINE_TRANSPORT_MARGIN_MS
      || now - attempt.startedAt >= DocumentGenerationService.MAXIMUM_OPERATION_AGE_MS;
  }

  private writeAttempt(attempt: StoredGenerationAttempt): void {
    this.memoryAttempts.set(this.memoryKey(attempt.canonicalJobId), attempt);
    const owner = this.ownerScope();
    if (!owner || typeof localStorage === 'undefined') return;
    const attempts = this.readStoredAttempts()
      .filter(candidate => candidate.canonicalJobId !== attempt.canonicalJobId);
    attempts.push(attempt);
    try {
      localStorage.setItem(
        `${DocumentGenerationService.ATTEMPT_STORAGE_PREFIX}${owner}`,
        JSON.stringify(attempts),
      );
    } catch {
      // In-memory recovery remains available when browser storage is disabled.
    }
  }

  private clearAttempt(canonicalJobId: string): void {
    this.memoryAttempts.delete(this.memoryKey(canonicalJobId));
    const owner = this.ownerScope();
    if (!owner || typeof localStorage === 'undefined') return;
    const attempts = this.readStoredAttempts()
      .filter(attempt => attempt.canonicalJobId !== canonicalJobId);
    try {
      const key = `${DocumentGenerationService.ATTEMPT_STORAGE_PREFIX}${owner}`;
      if (attempts.length) {
        localStorage.setItem(key, JSON.stringify(attempts));
      } else {
        localStorage.removeItem(key);
      }
    } catch {
      // A server-owned operation remains authoritative even without storage.
    }
  }

  private readStoredAttempts(): StoredGenerationAttempt[] {
    const owner = this.ownerScope();
    if (!owner || typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(
        `${DocumentGenerationService.ATTEMPT_STORAGE_PREFIX}${owner}`,
      );
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.filter((value): value is StoredGenerationAttempt =>
            this.validStoredAttempt(value))
        : [];
    } catch {
      return [];
    }
  }

  private validStoredAttempt(value: unknown): value is StoredGenerationAttempt {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const attempt = value as Partial<StoredGenerationAttempt>;
    if (
      attempt.version !== 1
      || typeof attempt.canonicalJobId !== 'string'
      || !/^[A-Za-z0-9._:-]{1,128}$/.test(attempt.canonicalJobId)
      || typeof attempt.idempotencyKey !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(attempt.idempotencyKey)
      || !Number.isSafeInteger(attempt.startedAt)
      || Number(attempt.startedAt) < 1
      || !this.validStoredEvidence(attempt.evidence, attempt.outputs)
    ) {
      return false;
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return (!attempt.savedJobId || uuid.test(attempt.savedJobId))
      && (!attempt.operationId || uuid.test(attempt.operationId))
      && (
        attempt.approvalRequested === undefined
        || typeof attempt.approvalRequested === 'boolean'
      )
      && (attempt.outputs === undefined || this.validRequestedOutputs(attempt.outputs));
  }

  private validStoredEvidence(
    evidence: GenerationEvidenceSelection | undefined,
    outputs: DocumentKind[] | undefined,
  ): evidence is GenerationEvidenceSelection {
    const sections = new Set(Object.values(DocumentEvidenceSelectionSectionOrderEnum));
    const requiredOutputs = this.validRequestedOutputs(outputs)
      ? outputs
      : ['CV', 'COVER_LETTER'];
    return Boolean(evidence)
      && requiredOutputs.map(output => output === 'CV' ? evidence?.cv : evidence?.coverLetter)
        .every(selection =>
        Boolean(selection)
        && Array.isArray(selection?.entryIds)
        && selection.entryIds.length >= 1
        && selection.entryIds.length <= 50
        && selection.entryIds.every(id =>
          typeof id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(id))
        && new Set(selection.entryIds).size === selection.entryIds.length
        && Array.isArray(selection.sectionOrder)
        && selection.sectionOrder.length >= 1
        && selection.sectionOrder.length <= sections.size
        && selection.sectionOrder.every(section => sections.has(section))
        && new Set(selection.sectionOrder).size === selection.sectionOrder.length
      );
  }

  private fileNameFromDisposition(disposition: string | null): string | null {
    if (!disposition) return null;
    const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1].replace(/"/g, ''));
    const asciiMatch = /filename="?([^";]+)"?/i.exec(disposition);
    return asciiMatch?.[1] ?? null;
  }

  private recoverySummaries(
    operation: GenerationOperationResponse,
  ): Partial<Record<DocumentKind, DocumentRecoverySummary>> | undefined {
    const rawResults = operation.outputResults;
    if (!rawResults || typeof rawResults !== 'object') return undefined;
    const summaries: Partial<Record<DocumentKind, DocumentRecoverySummary>> = {};
    for (const purpose of ['CV', 'COVER_LETTER'] as const) {
      const rawResult = rawResults[purpose];
      if (!rawResult || typeof rawResult !== 'object') continue;
      const rawSummary = (rawResult as {recoverySummary?: unknown}).recoverySummary;
      if (!rawSummary || typeof rawSummary !== 'object' || Array.isArray(rawSummary)) continue;
      const summary = rawSummary as Record<string, unknown>;
      if (
        typeof summary['generationSource'] !== 'string'
        || !GENERATION_SOURCES.has(summary['generationSource'] as GenerationSource)
        || typeof summary['billingStatus'] !== 'string'
        || !BILLING_STATUSES.has(summary['billingStatus'] as BillingStatus)
        || !['APPLIED', 'CHECKED', 'NOT_REQUIRED'].includes(
          String(summary['structuralRepairStatus']),
        )
        || !['NOT_REQUIRED', 'PENDING', 'RECOVERED', 'EXHAUSTED'].includes(
          String(summary['reconciliationStatus']),
        )
        || typeof summary['retried'] !== 'boolean'
        || typeof summary['retainedResponseReplayed'] !== 'boolean'
        || typeof summary['deterministicFallbackUsed'] !== 'boolean'
        || typeof summary['charged'] !== 'boolean'
        || typeof summary['released'] !== 'boolean'
        || !this.boundedRecoveryCount(summary['duplicateItemsRemoved'], 200)
        || !this.boundedRecoveryCount(summary['providerAttemptCount'], 2)
        || !this.boundedRecoveryCount(summary['automaticRetryCount'], 1)
        || !this.boundedRecoveryCount(summary['reconciliationAttempts'], 60)
      ) {
        continue;
      }
      const generationSource = summary['generationSource'] as GenerationSource;
      const billingStatus = summary['billingStatus'] as BillingStatus;
      if (
        summary['retried'] !== ((summary['automaticRetryCount'] as number) > 0)
        || summary['charged'] !== (billingStatus === 'COMMITTED')
        || summary['released'] !== billingStatus.startsWith('RELEASED_')
        || summary['deterministicFallbackUsed']
          !== (generationSource === 'DETERMINISTIC_FALLBACK')
        || (generationSource === 'DETERMINISTIC_FALLBACK'
          && billingStatus !== 'RELEASED_NO_CHARGE')
      ) {
        continue;
      }
      summaries[purpose] = summary as unknown as DocumentRecoverySummary;
    }
    return Object.keys(summaries).length ? summaries : undefined;
  }

  private boundedRecoveryCount(value: unknown, maximum: number): value is number {
    return typeof value === 'number'
      && Number.isSafeInteger(value)
      && value >= 0
      && value <= maximum;
  }

  private completedGeneration(
    operation: GenerationOperationResponse,
    requestedOutputs: DocumentKind[] = ['CV', 'COVER_LETTER'],
  ): DocumentGenerationResponse {
    const missingRequestedOutput =
      (requestedOutputs.includes('CV') && !operation.cvDocumentId)
      || (requestedOutputs.includes('COVER_LETTER') && !operation.coverLetterDocumentId);
    const partialGeneration = operation.failureCode?.trim().toUpperCase()
      === 'PARTIAL_GENERATION';
    if (
      operation.state !== 'COMPLETED'
      || !operation.applicationId
      || (!operation.cvDocumentId && !operation.coverLetterDocumentId)
      || (missingRequestedOutput && !partialGeneration)
    ) {
      throw this.operationError(operation);
    }
    const recovery = this.recoverySummaries(operation);
    return {
      applicationId: operation.applicationId,
      ...(operation.cvDocumentId ? {cvDocumentId: operation.cvDocumentId} : {}),
      ...(operation.coverLetterDocumentId
        ? {coverLetterDocumentId: operation.coverLetterDocumentId}
        : {}),
      downloads: {
        cv: this.exportDownloads(operation.downloads?.['cv']),
        coverLetter: this.exportDownloads(operation.downloads?.['coverLetter']),
      },
      ...(recovery ? {recovery} : {}),
    };
  }

  private exportDownloads(value: object | undefined): DocumentDownloadsResponse {
    const exports = value && 'exports' in value
      ? (value as {exports?: unknown}).exports
      : undefined;
    if (!Array.isArray(exports)) return {};

    const downloads: DocumentDownloadsResponse = {};
    for (const item of exports) {
      if (!item || typeof item !== 'object') continue;
      const exported = item as {
        fileId?: unknown;
        fileName?: unknown;
        format?: unknown;
      };
      if (typeof exported.fileId !== 'string') continue;
      const file: DownloadFileResponse = {
        fileId: exported.fileId,
        fileName: typeof exported.fileName === 'string' ? exported.fileName : undefined,
        downloadUrl: `/api/v1/document-generation/files/${encodeURIComponent(exported.fileId)}/download`,
      };
      if (exported.format === 'DOCX') downloads.docx = file;
      if (exported.format === 'PDF') downloads.pdf = file;
    }
    return downloads;
  }

  private operationError(operation: GenerationOperationResponse): DocumentGenerationError {
    const code = operation.failureCode?.toUpperCase() ?? '';
    if (code.includes('JOB_DESCRIPTION_REVIEW_REQUIRED')) {
      return new DocumentGenerationError(
        'DESCRIPTION_REQUIRED',
        'Review and confirm the complete job advert before generating. No document generation was used.',
      );
    }
    if (
      operation.state === GenerationOperationResponseStateEnum.GenerationOutcomeUnknown
      || operation.state === GenerationOperationResponseStateEnum.RecoveryRequired
      || code.includes('OUTCOME_UNKNOWN')
      || code.includes('RECOVERY')
    ) {
      return new DocumentGenerationError(
        'OUTCOME_UNKNOWN',
        'The provider outcome is unknown. No automatic retry was made; refresh before trying again.',
      );
    }
    if (operation.state === GenerationOperationResponseStateEnum.Cancelled) {
      return new DocumentGenerationError(
        'CANCELLED',
        'Document generation was cancelled. Your evidence selection has been kept.',
      );
    }
    if (code.includes('CREDIT') || code.includes('QUOTA')) {
      return new DocumentGenerationError(
        'QUOTA_EXHAUSTED',
        'There are not enough document generations to generate both documents.',
      );
    }
    if (code.includes('RATE_LIMIT')) {
      return new DocumentGenerationError(
        'RATE_LIMITED',
        'The AI provider is temporarily rate limited. Try again later.',
      );
    }
    if (code.includes('AUTH')) {
      return new DocumentGenerationError(
        'AUTH_REQUIRED',
        'Your session or AI provider authorisation must be refreshed.',
      );
    }
    if (code.includes('DISABLED') || code.includes('CONFIGURATION')) {
      return new DocumentGenerationError(
        'DISABLED',
        'Real document generation is not available in this environment.',
      );
    }
    if (code.includes('EVIDENCE') || code.includes('REVISION') || code.includes('STALE')) {
      return new DocumentGenerationError(
        'EVIDENCE_CHANGED',
        'One of the selected entries changed. Review and confirm your evidence before retrying.',
      );
    }
    if (code.includes('TIMEOUT') || code.includes('DEADLINE')) {
      return new DocumentGenerationError(
        'TIMEOUT',
        'Document generation did not finish before its deadline. Refresh before retrying.',
      );
    }
    return new DocumentGenerationError(
      'FAILED',
      'Document generation failed safely. Your evidence selection has been kept.',
    );
  }

  private generationError(error: unknown): DocumentGenerationError {
    if (error instanceof DocumentGenerationError) return error;
    const status = typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as {status?: unknown}).status)
      : undefined;
    const body = typeof error === 'object' && error !== null && 'error' in error
      ? (error as {error?: unknown}).error
      : undefined;
    const upstreamCode = typeof body === 'object' && body !== null
      ? String(
          (body as {error?: unknown; failureCode?: unknown}).error
          ?? (body as {failureCode?: unknown}).failureCode
          ?? '',
        ).toUpperCase()
      : typeof body === 'string'
        ? body.toUpperCase()
        : '';
    if (upstreamCode.includes('JOB_DESCRIPTION_REVIEW_REQUIRED')) {
      return new DocumentGenerationError(
        'DESCRIPTION_REQUIRED',
        'Review and confirm the complete job advert before generating. No document generation was used.',
      );
    }
    if (status === 401 || status === 403 || upstreamCode.includes('AUTH')) {
      return new DocumentGenerationError(
        'AUTH_REQUIRED',
        'Your session is no longer authorised. Sign in again before retrying.',
      );
    }
    if (
      status === 402
      || upstreamCode.includes('CREDIT')
      || upstreamCode.includes('QUOTA')
    ) {
      return new DocumentGenerationError(
        'QUOTA_EXHAUSTED',
        'There are not enough document generations to generate both documents.',
      );
    }
    if (status === 429 || upstreamCode.includes('RATE_LIMIT')) {
      return new DocumentGenerationError(
        'RATE_LIMITED',
        'The AI provider is temporarily rate limited. Try again later.',
      );
    }
    if (
      upstreamCode.includes('EVIDENCE')
      || upstreamCode.includes('REVISION')
      || upstreamCode.includes('STALE')
    ) {
      return new DocumentGenerationError(
        'EVIDENCE_CHANGED',
        'One of the selected entries changed. Review and confirm your evidence before retrying.',
      );
    }
    if (status === 409 || upstreamCode.includes('CONFLICT')) {
      return new DocumentGenerationError(
        'OUTCOME_UNKNOWN',
        'The operation changed and could not be updated safely. Refresh its status before retrying.',
      );
    }
    if (upstreamCode.includes('OUTCOME_UNKNOWN')) {
      return new DocumentGenerationError(
        'OUTCOME_UNKNOWN',
        'The provider outcome is unknown. No automatic retry was made; refresh before trying again.',
      );
    }
    if (status === 504 || upstreamCode.includes('TIMEOUT')) {
      return new DocumentGenerationError(
        'TIMEOUT',
        'Document generation is still processing or timed out. Refresh before retrying.',
      );
    }
    if (status === 503 || upstreamCode.includes('DISABLED')) {
      return new DocumentGenerationError(
        'DISABLED',
        'Real document generation is currently unavailable.',
      );
    }
    return new DocumentGenerationError(
      'FAILED',
      'Document generation failed safely. Your evidence selection has been kept.',
    );
  }

  private async errorMessage(response: Response, fallback: string): Promise<string> {
    const fallbackWithStatus = `${fallback} Status ${response.status}.`;
    const contentType = response.headers.get('content-type') ?? '';
    try {
      if (contentType.includes('application/json')) {
        const body = await response.json();
        return body.message || body.error || fallbackWithStatus;
      }
      const text = await response.text();
      return text || fallbackWithStatus;
    } catch {
      return fallbackWithStatus;
    }
  }
}
