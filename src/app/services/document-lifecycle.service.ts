import {inject, Injectable} from '@angular/core';
import {Observable, switchMap} from 'rxjs';
import {
  DocumentApplicationAssociation,
  DocumentApplicationAssociationsResponse,
  DocumentLifecycleControllerService,
  DocumentVersionLifecycleResponse,
} from '../api/document-generation-gateway';
import {BrowserSessionService} from './browser-session.service';

export const DOCUMENT_LIFECYCLE_COPY = {
  archive: 'Archive this document? It will no longer be selected for new applications. You can restore it later.',
  archived: 'This document is archived. Restore it before using or editing it.',
  irreversibleDeletion: 'After the recovery period and required retention checks, deletion may become permanent. Copies already downloaded by you are not controlled by Job Seeker Copilot.',
  purged: 'This document’s content is no longer available. Its exact version and application history are kept so your records remain accurate.',
} as const;

export function deleteDocumentCopy(purgeEligibleAt: string): string {
  return `Move this document to Deleted? You can restore it until ${purgeEligibleAt}. Files will not be available while it is deleted.`;
}

export function deletedDocumentCopy(purgeEligibleAt: string): string {
  return `This document is deleted but recoverable until ${purgeEligibleAt}. Restoring it will not select it as your current document.`;
}

export function associatedDocumentCopy(
  associations: DocumentApplicationAssociation[],
): string | null {
  const draftCount = associations.filter(
    association => association.associationState === 'DRAFT_SELECTED',
  ).length;
  const frozenCount = associations.filter(
    association => association.associationState === 'FROZEN_USED',
  ).length;
  if (!draftCount && !frozenCount) return null;

  const uses = [
    ...(draftCount ? [
      `${draftCount} draft application${draftCount === 1 ? '' : 's'}`,
    ] : []),
    ...(frozenCount ? [
      `${frozenCount} submitted application${frozenCount === 1 ? '' : 's'}`,
    ] : []),
  ].join(' and ');
  return `This exact version is linked to ${uses}. Archive is recommended. Deleting it will not switch those applications to another version.`;
}

@Injectable({providedIn: 'root'})
export class DocumentLifecycleService {
  private readonly api = inject(DocumentLifecycleControllerService);
  private readonly browserSession = inject(BrowserSessionService);

  associations(documentId: string): Observable<DocumentApplicationAssociationsResponse> {
    return this.api.associations(
      documentId,
      'body',
      false,
      {transferCache: false},
    );
  }

  archive(documentId: string): Observable<DocumentVersionLifecycleResponse> {
    return this.browserSession.ensureCsrf().pipe(
      switchMap(() => this.api.archive(
        documentId,
        'body',
        false,
        {transferCache: false},
      )),
    );
  }

  restore(documentId: string): Observable<DocumentVersionLifecycleResponse> {
    return this.browserSession.ensureCsrf().pipe(
      switchMap(() => this.api.restore(
        documentId,
        'body',
        false,
        {transferCache: false},
      )),
    );
  }

  delete(documentId: string): Observable<void> {
    return this.browserSession.ensureCsrf().pipe(
      switchMap(() => this.api._delete(
        documentId,
        'body',
        false,
        {transferCache: false},
      ) as Observable<void>),
    );
  }
}
