import {
  latestUserUploadTimestamp,
  MyApplicationsComponent,
} from './my-applications.component';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import {
  ApplicationTrackerService,
  TrackedApplication,
} from '../../services/application-tracker.service';
import { DocumentGenerationService } from '../../services/document-generation.service';

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

describe('MyApplicationsComponent authoritative refreshes', () => {
  let applicationResponses: Subject<TrackedApplication[]>[];
  const applicationTracker = {
    listApplications: vi.fn(() => applicationResponses.shift() ?? of([])),
    eventsForApplication: vi.fn(() => []),
    updateStatus: vi.fn(() => of({})),
    withdrawGeneratedApplication: vi.fn(() => of({
      processing: false,
      withdrawn: true,
    })),
  };
  const documentGeneration = {
    latestFiles: vi.fn(() => of({})),
    allFileMetadata: vi.fn(() => of([])),
    uploadReplacement: vi.fn(),
    isDocx: vi.fn(() => true),
    download: vi.fn(),
  };

  beforeEach(async () => {
    applicationResponses = [];
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [MyApplicationsComponent],
      providers: [
        {provide: ApplicationTrackerService, useValue: applicationTracker},
        {provide: DocumentGenerationService, useValue: documentGeneration},
      ],
    }).compileComponents();
  });

  it('ignores a stale application response after a newer refresh completes', () => {
    const first = new Subject<TrackedApplication[]>();
    const second = new Subject<TrackedApplication[]>();
    applicationResponses = [first, second];
    const fixture = TestBed.createComponent(MyApplicationsComponent);
    fixture.detectChanges();

    fixture.componentInstance.refresh();
    second.next([{applicationId: 'new', id: 'new', status: 'SAVED'}]);
    first.next([{applicationId: 'old', id: 'old', status: 'SAVED'}]);

    expect(fixture.componentInstance.applications().map(item => item.id))
      .toEqual(['new']);
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it('clears a status busy flag after an error so the action can be retried', () => {
    applicationResponses = [new Subject<TrackedApplication[]>()];
    applicationTracker.updateStatus.mockReturnValueOnce(
      throwError(() => new Error('rejected')),
    );
    const fixture = TestBed.createComponent(MyApplicationsComponent);
    fixture.detectChanges();
    const application = {
      applicationId: 'application-1',
      id: 'application-1',
      status: 'SAVED',
    } as TrackedApplication;

    fixture.componentInstance.updateStatus(application, 'APPLIED');

    expect(fixture.componentInstance.isUpdating(application)).toBe(false);
  });

  it('retains an application while an accepted withdrawal is processing', () => {
    applicationResponses = [new Subject<TrackedApplication[]>()];
    applicationTracker.withdrawGeneratedApplication.mockReturnValueOnce(of({
      processing: true,
      withdrawn: false,
      operationStatus: 'PROCESSING',
    }));
    const fixture = TestBed.createComponent(MyApplicationsComponent);
    fixture.detectChanges();
    const application = {
      applicationId: 'application-1',
      id: 'application-1',
      status: 'DOCUMENTS_GENERATED',
    } as TrackedApplication;
    fixture.componentInstance.applications.set([application]);
    const notices: {message: string; type: string}[] = [];
    fixture.componentInstance.notify.subscribe(notice => notices.push(notice));

    fixture.componentInstance.updateStatus(application, 'WITHDRAWN');

    expect(fixture.componentInstance.applications()).toEqual([application]);
    expect(notices.at(-1)?.type).toBe('info');
    expect(fixture.componentInstance.isUpdating(application)).toBe(false);
  });
});
