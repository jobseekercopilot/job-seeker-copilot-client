import { HttpClient } from '@angular/common/http';
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
} from 'rxjs';
import { Job } from '../models/job-search.model';
import {
  DocumentDownloadsResponse,
  DocumentEvidenceSelectionPurposeEnum,
  DocumentEvidenceSelectionSectionOrderEnum,
  DocumentGenerationControllerService,
  DownloadFileResponse,
  GenerationOperationResponse,
  GenerationOperationResponseStateEnum,
} from '../api/document-generation-gateway';
import {
  Job as SavedJob,
  SavedJobsService,
} from '../api/job-finder';
import { BrowserSessionService } from './browser-session.service';

export type DocumentKind = 'CV' | 'COVER_LETTER';
export type UploadFormat = 'DOCX' | 'PDF';

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

export interface DocumentGenerationResponse {
  applicationId: string;
  cvDocumentId: string;
  coverLetterDocumentId: string;
  downloads: GenerationDownloadsResponse;
}

export type DocumentGenerationErrorCode =
  | 'AUTH_REQUIRED'
  | 'CANCELLED'
  | 'DISABLED'
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
}

@Injectable({ providedIn: 'root' })
export class DocumentGenerationService {
  private static readonly ATTEMPT_STORAGE_PREFIX = 'jsc-document-generation-v1:';
  private static readonly MAXIMUM_OPERATION_AGE_MS = 11 * 60 * 1000;
  private static readonly DEADLINE_TRANSPORT_MARGIN_MS = 15_000;
  private static readonly POLL_INTERVAL_MS = 1_500;
  private readonly api = inject(DocumentGenerationControllerService);
  private readonly savedJobs = inject(SavedJobsService);
  private readonly browserSession = inject(BrowserSessionService);
  private readonly http = inject(HttpClient);
  private readonly memoryAttempts = new Map<string, StoredGenerationAttempt>();
  private readonly activeGenerations = new Map<string, Observable<DocumentGenerationResponse>>();
  private readonly cancellationSignals = new Map<string, Subject<void>>();

  generate(job: Job, evidence: GenerationEvidenceSelection): Observable<DocumentGenerationResponse> {
    const canonicalJobId = job.canonicalJobId ?? job.id;
    if (!canonicalJobId || !job.title || !job.company || !job.description) {
      throw new Error('The selected job does not contain the data required for generation.');
    }
    if (
      !evidence.cv.entryIds.length
      || !evidence.cv.sectionOrder.length
      || !evidence.coverLetter.entryIds.length
      || !evidence.coverLetter.sectionOrder.length
    ) {
      throw new Error('Choose entries confirmed by you for both the CV and cover letter.');
    }

    const active = this.activeGenerations.get(canonicalJobId);
    if (active) return active;

    const attempt = this.readAttempt(canonicalJobId) ?? {
      version: 1,
      canonicalJobId,
      idempotencyKey: `browser-${crypto.randomUUID()}`,
      startedAt: Date.now(),
      evidence: this.copyEvidence(evidence),
    } satisfies StoredGenerationAttempt;
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
        job as SavedJob,
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
        return this.monitorAttempt(attempt, true);
      }),
    );
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
    return this.api.startOperation(
      attempt.savedJobId,
      attempt.idempotencyKey,
      {
        documents: [
          {
            purpose: DocumentEvidenceSelectionPurposeEnum.Cv,
            entryIds: [...attempt.evidence.cv.entryIds],
            sectionOrder: [...attempt.evidence.cv.sectionOrder],
          },
          {
            purpose: DocumentEvidenceSelectionPurposeEnum.CoverLetter,
            entryIds: [...attempt.evidence.coverLetter.entryIds],
            sectionOrder: [...attempt.evidence.coverLetter.sectionOrder],
          },
        ],
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
    let replayAvailable = safeStartReplay && Boolean(attempt.savedJobId);
    let observedDeadline = attempt.startedAt
      + DocumentGenerationService.MAXIMUM_OPERATION_AGE_MS;

    return defer(() => this.api.getOperation(
      attempt.operationId as string,
      'body',
      false,
      {transferCache: false},
    )).pipe(
      expand(operation => {
        observedDeadline = Math.min(
          observedDeadline,
          this.operationDeadline(operation) ?? observedDeadline,
        );

        if (this.isTerminal(operation.state)) return EMPTY;
        if (
          replayAvailable
          && operation.replaySafe !== false
          && this.isSafePreProviderState(operation.state)
        ) {
          replayAvailable = false;
          return this.browserSession.ensureCsrf().pipe(
            switchMap(() => this.startOperation(attempt)),
          );
        }
        if (
          approvalAvailable
          && this.isApprovalRecoveryState(operation.state)
        ) {
          if (!operation.cvDocumentId || !operation.coverLetterDocumentId) {
            return throwError(() => new DocumentGenerationError(
              'FAILED',
              'The generation operation is missing its document references.',
            ));
          }
          approvalAvailable = false;
          attempt.approvalRequested = true;
          this.writeAttempt(attempt);
          return this.browserSession.ensureCsrf().pipe(
            switchMap(() => this.api.approveOperation(
              attempt.operationId as string,
              {
                cvDocumentId: operation.cvDocumentId as string,
                coverLetterDocumentId: operation.coverLetterDocumentId as string,
              },
              'body',
              false,
              {transferCache: false},
            )),
          );
        }
        if (Date.now() >= observedDeadline) {
          return throwError(() => new DocumentGenerationError(
            'TIMEOUT',
            'Document generation is still processing. Refresh later; no duplicate request was made.',
          ));
        }
        return timer(DocumentGenerationService.POLL_INTERVAL_MS).pipe(
          switchMap(() => this.api.getOperation(
            attempt.operationId as string,
            'body',
            false,
            {transferCache: false},
          )),
        );
      }),
      tap(operation => this.acceptOperation(attempt, operation)),
      filter(operation => this.isTerminal(operation.state)),
      take(1),
      map(operation => {
        if (operation.state !== GenerationOperationResponseStateEnum.Completed) {
          this.clearAttempt(attempt.canonicalJobId);
          throw this.operationError(operation);
        }
        const completed = this.completedGeneration(operation);
        this.clearAttempt(attempt.canonicalJobId);
        return completed;
      }),
    );
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
      GenerationOperationResponseStateEnum.Estimated,
      GenerationOperationResponseStateEnum.CreditReserved,
      GenerationOperationResponseStateEnum.DraftGenerated,
      GenerationOperationResponseStateEnum.CreditCommitted,
      GenerationOperationResponseStateEnum.DraftsStored,
    ].includes(state as GenerationOperationResponseStateEnum);
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

    const response = await fetch(`/api/v1/document-generation/files/${encodeURIComponent(file.fileId)}/download`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}.`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = this.fileNameFromDisposition(response.headers.get('content-disposition')) || file.fileName || 'document';
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

  isDocx(file: File): boolean {
    const hasDocxExtension = file.name.toLowerCase().endsWith('.docx');
    const mimeType = file.type;
    const hasAllowedMimeType = !mimeType
      || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return hasDocxExtension && hasAllowedMimeType;
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
    return Array.from(attempts.values());
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
      || !this.validStoredEvidence(attempt.evidence)
    ) {
      return false;
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return (!attempt.savedJobId || uuid.test(attempt.savedJobId))
      && (!attempt.operationId || uuid.test(attempt.operationId))
      && (
        attempt.approvalRequested === undefined
        || typeof attempt.approvalRequested === 'boolean'
      );
  }

  private validStoredEvidence(
    evidence: GenerationEvidenceSelection | undefined,
  ): evidence is GenerationEvidenceSelection {
    const sections = new Set(Object.values(DocumentEvidenceSelectionSectionOrderEnum));
    return Boolean(evidence)
      && [evidence?.cv, evidence?.coverLetter].every(selection =>
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

  private completedGeneration(operation: GenerationOperationResponse): DocumentGenerationResponse {
    if (
      operation.state !== 'COMPLETED'
      || !operation.applicationId
      || !operation.cvDocumentId
      || !operation.coverLetterDocumentId
    ) {
      throw this.operationError(operation);
    }
    return {
      applicationId: operation.applicationId,
      cvDocumentId: operation.cvDocumentId,
      coverLetterDocumentId: operation.coverLetterDocumentId,
      downloads: {
        cv: this.exportDownloads(operation.downloads?.['cv']),
        coverLetter: this.exportDownloads(operation.downloads?.['coverLetter']),
      },
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
        'There is not enough AI credit to generate both documents.',
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
        'There is not enough AI credit to generate both documents.',
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
