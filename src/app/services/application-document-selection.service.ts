import {HttpErrorResponse} from '@angular/common/http';
import {inject, Injectable} from '@angular/core';
import {catchError, map, Observable, switchMap, throwError} from 'rxjs';
import {
  ApplicationDocumentSelectionControllerService,
  type ApplicationDocumentSelectionsResponse,
  type ApplicationSelectionConflictResponse,
  type SaveApplicationDocumentSelectionsRequest as GeneratedSelectionRequest,
} from '../api/document-generation-gateway';
import {BrowserSessionService} from './browser-session.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type ApplicationDocumentSelection =
  | {state: 'SELECTED'; documentId: string}
  | {state: 'OMITTED'};

export interface SaveApplicationDocumentSelectionsRequest {
  cvSelection: ApplicationDocumentSelection;
  coverLetterSelection: ApplicationDocumentSelection;
  expectedVersion: number;
}

export interface ApplicationSelectionRecord
    extends ApplicationDocumentSelectionsResponse {
  id: string;
  status:
    | 'SAVED'
    | 'DOCUMENTS_GENERATED'
    | 'APPLIED'
    | 'INTERVIEW'
    | 'UNSUCCESSFUL'
    | 'OFFER'
    | 'ACCEPTED'
    | 'REJECTED_BY_USER'
    | 'WITHDRAWN';
  version: number;
}

export class ApplicationDocumentSelectionConflict extends Error {
  constructor(readonly currentApplication: ApplicationSelectionRecord) {
    super('The application changed; review the current selections before saving again.');
    this.name = 'ApplicationDocumentSelectionConflict';
  }
}

@Injectable({providedIn: 'root'})
export class ApplicationDocumentSelectionService {
  private readonly api = inject(ApplicationDocumentSelectionControllerService);
  private readonly browserSession = inject(BrowserSessionService);

  saveSelections(
    applicationId: string,
    request: SaveApplicationDocumentSelectionsRequest,
    idempotencyKey: string,
  ): Observable<ApplicationSelectionRecord> {
    const normalizedApplicationId = this.validUuid(
      applicationId,
      'Application identifier',
    );
    const normalizedRequest = this.validRequest(request);
    const normalizedKey = idempotencyKey.trim();
    if (!IDEMPOTENCY_KEY.test(normalizedKey)) {
      throw new Error('A valid idempotency key is required.');
    }

    return this.browserSession.ensureCsrf().pipe(
      switchMap(() => this.api.save(
        normalizedApplicationId,
        normalizedKey,
        normalizedRequest as GeneratedSelectionRequest,
        'body',
        false,
        {transferCache: false},
      )),
      map(record => {
        const authoritative = this.applicationRecord(record);
        if (!authoritative) {
          throw new Error('The document service returned an invalid application record.');
        }
        return authoritative;
      }),
      catchError(error => {
        const stale = this.staleResponse(error);
        return stale
          ? throwError(() => new ApplicationDocumentSelectionConflict(
            stale.currentApplication,
          ))
          : throwError(() => error);
      }),
    );
  }

  selected(documentId: string): ApplicationDocumentSelection {
    return {state: 'SELECTED', documentId: this.validUuid(documentId, 'Document identifier')};
  }

  omitted(): ApplicationDocumentSelection {
    return {state: 'OMITTED'};
  }

  private validRequest(
    request: SaveApplicationDocumentSelectionsRequest,
  ): SaveApplicationDocumentSelectionsRequest {
    if (
      !request
      || !Number.isSafeInteger(request.expectedVersion)
      || request.expectedVersion < 0
    ) {
      throw new Error('A non-negative application version is required.');
    }
    return {
      cvSelection: this.validSelection(request.cvSelection),
      coverLetterSelection: this.validSelection(request.coverLetterSelection),
      expectedVersion: request.expectedVersion,
    };
  }

  private validSelection(
    selection: ApplicationDocumentSelection,
  ): ApplicationDocumentSelection {
    if (selection?.state === 'OMITTED') return {state: 'OMITTED'};
    if (selection?.state === 'SELECTED') {
      return {
        state: 'SELECTED',
        documentId: this.validUuid(selection.documentId, 'Document identifier'),
      };
    }
    throw new Error('Each document slot must be selected or omitted explicitly.');
  }

  private validUuid(value: string, label: string): string {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || !UUID.test(normalized)) {
      throw new Error(`${label} is invalid.`);
    }
    return normalized;
  }

  private staleResponse(
    error: unknown,
  ): {currentApplication: ApplicationSelectionRecord} | undefined {
    if (!(error instanceof HttpErrorResponse) || error.status !== 409) {
      return undefined;
    }
    const payload = error.error as ApplicationSelectionConflictResponse | undefined;
    const currentApplication = this.applicationRecord(payload?.currentApplication);
    return payload?.status === 409
      && typeof payload.message === 'string'
      && currentApplication
      ? {currentApplication}
      : undefined;
  }

  private applicationRecord(
    value: ApplicationDocumentSelectionsResponse | undefined,
  ): ApplicationSelectionRecord | undefined {
    return value
      && typeof value.id === 'string'
      && UUID.test(value.id)
      && typeof value.status === 'string'
      && Number.isSafeInteger(value.version)
      && (value.version ?? -1) >= 0
      ? value as ApplicationSelectionRecord
      : undefined;
  }
}
