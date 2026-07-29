import {
  latestUserUploadTimestamp,
  MyApplicationsComponent,
} from './my-applications.component';
import { TrackedApplication } from '../../services/application-tracker.service';

describe('MyApplicationsComponent document replacement', () => {
  const component = Object.create(MyApplicationsComponent.prototype) as MyApplicationsComponent;

  const application = (status: string, applicationId = 'application-1') => ({
    applicationId,
    status,
  } as TrackedApplication);

  it('allows document replacement before the application is marked applied', () => {
    expect(component.canUploadDocuments(application('DOCUMENTS_GENERATED'))).toBe(true);
  });

  it.each([
    'APPLIED',
    'INTERVIEW',
    'OFFER',
    'ACCEPTED',
    'UNSUCCESSFUL',
    'WITHDRAWN',
  ])('locks document replacement after the generated-document stage (%s)', status => {
    expect(component.canUploadDocuments(application(status))).toBe(false);
  });

  it('requires a persisted application identifier', () => {
    expect(component.canUploadDocuments(application('DOCUMENTS_GENERATED', ''))).toBe(false);
  });

  it('presents saved and prepared states using claimant-facing labels', () => {
    expect(component.statusLabel('SAVED')).toBe('Saved to applications');
    expect(component.statusLabel('DOCUMENTS_GENERATED')).toBe('Documents prepared');
  });

  it('keeps saved applications in needs action and allows marking them applied', () => {
    const saved = application('SAVED');

    expect((component as any).matchesFilter(saved, 'NEEDS_ACTION')).toBe(true);
    expect(component.actions(saved)).toEqual([
      {label: 'Mark as Applied', status: 'APPLIED'},
    ]);
  });

  it('derives the uploaded milestone from durable user-uploaded metadata', () => {
    expect(latestUserUploadTimestamp([
      {
        source: 'SYSTEM_GENERATED',
        createdAt: '2026-07-28T08:00:00Z',
      },
      {
        source: 'USER_UPLOADED',
        createdAt: '2026-07-28T09:00:00Z',
      },
      {
        source: 'USER_UPLOADED',
        updatedAt: '2026-07-28T10:00:00Z',
      },
    ])).toBe('2026-07-28T10:00:00Z');
  });

  it('does not invent an upload milestone for generated-only documents', () => {
    expect(latestUserUploadTimestamp([
      {
        source: 'SYSTEM_GENERATED',
        createdAt: '2026-07-28T08:00:00Z',
      },
      {
        source: 'SYSTEM_GENERATED',
        createdAt: '2026-07-28T08:01:00Z',
      },
    ])).toBeUndefined();
  });

  it('shows frozen application-used provenance instead of a later current draft', () => {
    const tracked = {
      cvDocumentReference: {
        documentId: 'current-cv',
        evidenceProvenance: {
          profileRevisionId: 'current-profile',
          evidenceSnapshotId: 'current-snapshot',
        },
      },
      applicationUsedCvDocumentReference: {
        documentId: 'used-cv',
        evidenceProvenance: {
          profileRevisionId: 'used-profile',
          evidenceSnapshotId: 'used-snapshot',
          evidenceRevisions: [{ revisionNumber: 2 }],
          sectionOrder: ['PROJECT'],
        },
      },
      applicationUsedAt: '2026-07-29T03:00:00Z',
    } as TrackedApplication;

    const references = component.evidenceReferences(tracked);

    expect(references).toHaveLength(1);
    expect(references[0].reference.documentId).toBe('used-cv');
    expect(references[0].reference.evidenceProvenance?.profileRevisionId)
      .toBe('used-profile');
    expect(component.evidenceCount(references[0].reference)).toBe(1);
    expect(component.evidenceSections(references[0].reference)).toBe('Project');
    expect(component.evidenceScopeText(tracked)).toContain('Frozen when applied');
  });

  it('marks user-edited documents as requiring review', () => {
    const reference = {
      groundingState: 'USER_EDITED_REVIEW_REQUIRED',
    } as NonNullable<TrackedApplication['cvDocumentReference']>;

    expect(component.groundingNeedsReview(reference)).toBe(true);
    expect(component.groundingLabel(reference)).toBe('Review required');
  });
});
