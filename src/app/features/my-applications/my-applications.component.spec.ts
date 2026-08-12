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
import {
  ApplicationDocumentSelectionConflict,
  ApplicationDocumentSelectionService,
} from '../../services/application-document-selection.service';
import {DocumentLifecycleService} from '../../services/document-lifecycle.service';
import {
  DocumentArtifactManifestItemFormatEnum,
  DocumentFamilySummaryDocumentTypeEnum,
} from '../../api/document-generation-gateway';

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

  it('allows an offer to be accepted or declined', () => {
    expect(component.actions(application('OFFER'))).toEqual([
      {label: 'Mark Accepted', status: 'ACCEPTED'},
      {label: 'Decline Offer', status: 'REJECTED_BY_USER', danger: true},
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
      status: 'APPLIED',
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
      applicationUsedCvState: 'SELECTED',
      applicationUsedCoverLetterState: 'OMITTED',
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

  it('does not fall back to a draft reference when an applied slot was omitted', () => {
    const tracked = {
      status: 'APPLIED',
      cvDocumentReference: {documentId: 'draft-cv'},
      applicationUsedCvState: 'OMITTED',
      applicationUsedCoverLetterState: 'UNKNOWN',
    } as TrackedApplication;

    expect(component.evidenceReferences(tracked)).toEqual([]);
    expect(component.frozenSlotText(tracked, 'CV')).toBe('No CV used');
    expect(component.frozenSlotText(tracked, 'COVER_LETTER'))
      .toContain('unknown for this legacy application');
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
    downloadArtifact: vi.fn(() => Promise.resolve()),
  };
  const documentSelections = {
    selected: vi.fn((documentId: string) => ({state: 'SELECTED', documentId})),
    omitted: vi.fn(() => ({state: 'OMITTED'})),
    saveSelections: vi.fn(),
  };
  const documentLifecycle = {
    allFamilies: vi.fn<DocumentLifecycleService['allFamilies']>(() => of([])),
    history: vi.fn<DocumentLifecycleService['history']>(() => of({versions: []})),
  };

  beforeEach(async () => {
    applicationResponses = [];
    vi.clearAllMocks();
    documentLifecycle.allFamilies.mockReturnValue(of([]));
    documentLifecycle.history.mockReturnValue(of({versions: []}));
    await TestBed.configureTestingModule({
      imports: [MyApplicationsComponent],
      providers: [
        {provide: ApplicationTrackerService, useValue: applicationTracker},
        {provide: DocumentGenerationService, useValue: documentGeneration},
        {provide: ApplicationDocumentSelectionService, useValue: documentSelections},
        {provide: DocumentLifecycleService, useValue: documentLifecycle},
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

  it('loads approved versions lazily and recommends current without selecting it', () => {
    applicationResponses = [new Subject<TrackedApplication[]>()];
    const cvFamilyId = '11111111-1111-4111-8111-111111111111';
    const coverFamilyId = '22222222-2222-4222-8222-222222222222';
    const otherFamilyId = '33333333-3333-4333-8333-333333333333';
    documentLifecycle.allFamilies.mockReturnValue(of([
      {documentFamilyId: cvFamilyId, jobId: 'job-1', documentType: DocumentFamilySummaryDocumentTypeEnum.Cv},
      {documentFamilyId: coverFamilyId, jobId: 'job-1', documentType: DocumentFamilySummaryDocumentTypeEnum.CoverLetter},
      {documentFamilyId: otherFamilyId, jobId: 'other-job', documentType: DocumentFamilySummaryDocumentTypeEnum.Cv},
    ]));
    documentLifecycle.history.mockImplementation((familyId: string) => of({
      versions: familyId === cvFamilyId ? [
        {
          documentId: '44444444-4444-4444-8444-444444444444',
          version: 1,
          lifecycle: 'APPROVED',
          retention: 'AVAILABLE',
          current: false,
        },
        {
          documentId: '55555555-5555-4555-8555-555555555555',
          version: 2,
          lifecycle: 'APPROVED',
          retention: 'AVAILABLE',
          current: true,
        },
        {
          documentId: '66666666-6666-4666-8666-666666666666',
          version: 3,
          lifecycle: 'APPROVED',
          retention: 'DELETED',
        },
      ] : [],
    }));
    const fixture = TestBed.createComponent(MyApplicationsComponent);
    fixture.detectChanges();
    const application = {
      id: '77777777-7777-4777-8777-777777777777',
      applicationId: '77777777-7777-4777-8777-777777777777',
      canonicalJobId: 'job-1',
      status: 'SAVED',
      version: 1,
    } as TrackedApplication;

    fixture.componentInstance.documentPanelToggled(
      application,
      {currentTarget: {open: true}} as unknown as Event,
    );

    const panel = fixture.componentInstance.documentPanel(application);
    expect(documentLifecycle.history).toHaveBeenCalledTimes(2);
    expect(panel.cvSelection).toBe('');
    expect(panel.coverLetterSelection).toBe('');
    expect(fixture.componentInstance.documentOptions(application, 'CV')
      .map(option => option.documentId)).toEqual([
      '55555555-5555-4555-8555-555555555555',
      '44444444-4444-4444-8444-444444444444',
    ]);
    expect(documentSelections.saveSelections).not.toHaveBeenCalled();
  });

  it('rehydrates persisted selections after approved options load asynchronously', () => {
    const response = new Subject<TrackedApplication[]>();
    applicationResponses = [response];
    const applicationId = '77777777-7777-4777-8777-777777777777';
    const cvId = '55555555-5555-4555-8555-555555555555';
    const coverId = '66666666-6666-4666-8666-666666666666';
    const cvFamilyId = '11111111-1111-4111-8111-111111111111';
    const coverFamilyId = '22222222-2222-4222-8222-222222222222';
    documentLifecycle.allFamilies.mockReturnValue(of([
      {documentFamilyId: cvFamilyId, jobId: 'job-1', documentType: DocumentFamilySummaryDocumentTypeEnum.Cv},
      {documentFamilyId: coverFamilyId, jobId: 'job-1', documentType: DocumentFamilySummaryDocumentTypeEnum.CoverLetter},
    ]));
    documentLifecycle.history.mockImplementation((familyId: string) => of({versions: [{
      documentId: familyId === cvFamilyId ? cvId : coverId,
      version: 1,
      lifecycle: 'APPROVED',
      retention: 'AVAILABLE',
      current: true,
    }]}));
    const application = {
      id: applicationId,
      applicationId,
      canonicalJobId: 'job-1',
      jobTitle: 'Java Software Developer',
      companyName: 'Northstar Digital Labs',
      status: 'DOCUMENTS_GENERATED',
      version: 3,
      cvDocumentReference: {documentId: cvId},
      coverLetterDocumentReference: {documentId: coverId},
    } as TrackedApplication;
    const fixture = TestBed.createComponent(MyApplicationsComponent);
    fixture.detectChanges();
    response.next([application]);
    fixture.detectChanges();

    const details = fixture.nativeElement.querySelector(
      '[data-testid="application-documents"]',
    ) as HTMLDetailsElement;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();

    const selections = details.querySelectorAll('select');
    expect(selections[0].value).toBe(cvId);
    expect(selections[1].value).toBe(coverId);
  });

  it('saves both slots atomically and reuses the idempotency key for a retry', () => {
    applicationResponses = [new Subject<TrackedApplication[]>()];
    const applicationId = '77777777-7777-4777-8777-777777777777';
    const cvId = '55555555-5555-4555-8555-555555555555';
    const familyId = '11111111-1111-4111-8111-111111111111';
    documentLifecycle.allFamilies.mockReturnValue(of([{
      documentFamilyId: familyId,
      jobId: 'job-1',
      documentType: DocumentFamilySummaryDocumentTypeEnum.Cv,
    }]));
    documentLifecycle.history.mockReturnValue(of({versions: [{
      documentId: cvId,
      version: 2,
      lifecycle: 'APPROVED',
      retention: 'AVAILABLE',
    }]}));
    documentSelections.saveSelections
      .mockReturnValueOnce(throwError(() => new Error('network')))
      .mockReturnValueOnce(of({
        id: applicationId,
        status: 'SAVED',
        version: 5,
        cvDocumentId: cvId,
        cvDocumentReference: {documentId: cvId},
      }));
    const fixture = TestBed.createComponent(MyApplicationsComponent);
    fixture.detectChanges();
    const application = {
      id: applicationId,
      applicationId,
      canonicalJobId: 'job-1',
      status: 'SAVED',
      version: 4,
    } as TrackedApplication;
    fixture.componentInstance.applications.set([application]);
    fixture.componentInstance.documentPanelToggled(
      application,
      {currentTarget: {open: true}} as unknown as Event,
    );
    fixture.componentInstance.selectionChanged(
      application,
      'CV',
      {target: {value: cvId}} as unknown as Event,
    );

    fixture.componentInstance.saveDocumentSelections(application);
    fixture.componentInstance.saveDocumentSelections(application);

    const first = documentSelections.saveSelections.mock.calls[0];
    const second = documentSelections.saveSelections.mock.calls[1];
    expect(first[1]).toEqual({
      cvSelection: {state: 'SELECTED', documentId: cvId},
      coverLetterSelection: {state: 'OMITTED'},
      expectedVersion: 4,
    });
    expect(second[2]).toBe(first[2]);
    expect(fixture.componentInstance.applications()[0].version).toBe(5);
    expect(fixture.componentInstance.documentPanel(application).message)
      .toBe('Exact document selections saved.');
  });

  it('replaces stale local selections with the authoritative conflict record', () => {
    applicationResponses = [new Subject<TrackedApplication[]>()];
    const applicationId = '77777777-7777-4777-8777-777777777777';
    const authoritativeCvId = '88888888-8888-4888-8888-888888888888';
    documentSelections.saveSelections.mockReturnValueOnce(throwError(() =>
      new ApplicationDocumentSelectionConflict({
        id: applicationId,
        status: 'DOCUMENTS_GENERATED',
        version: 8,
        cvDocumentReference: {documentId: authoritativeCvId},
      })
    ));
    const fixture = TestBed.createComponent(MyApplicationsComponent);
    fixture.detectChanges();
    const application = {
      id: applicationId,
      applicationId,
      status: 'SAVED',
      version: 7,
    } as TrackedApplication;
    fixture.componentInstance.applications.set([application]);
    fixture.componentInstance.documentPanelToggled(
      application,
      {currentTarget: {open: true}} as unknown as Event,
    );

    fixture.componentInstance.saveDocumentSelections(application);

    expect(fixture.componentInstance.applications()[0].version).toBe(8);
    expect(fixture.componentInstance.documentPanel(application).cvSelection)
      .toBe(authoritativeCvId);
    expect(fixture.componentInstance.documentPanel(application).error)
      .toContain('changed elsewhere');
  });

  it('loads and downloads only the frozen exact version after application', () => {
    applicationResponses = [new Subject<TrackedApplication[]>()];
    const familyId = '11111111-1111-4111-8111-111111111111';
    const usedId = '55555555-5555-4555-8555-555555555555';
    const laterId = '99999999-9999-4999-8999-999999999999';
    const artifactId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    documentLifecycle.history.mockReturnValue(of({versions: [
      {
        documentId: usedId,
        version: 2,
        lifecycle: 'ARCHIVED',
        retention: 'AVAILABLE',
        artifacts: [{
          artifactId,
          role: 'DERIVED',
          format: DocumentArtifactManifestItemFormatEnum.Pdf,
          availability: 'AVAILABLE',
          size: 120,
        }],
      },
      {
        documentId: laterId,
        version: 3,
        lifecycle: 'APPROVED',
        retention: 'AVAILABLE',
        current: true,
      },
    ]}));
    const fixture = TestBed.createComponent(MyApplicationsComponent);
    fixture.detectChanges();
    const application = {
      id: '77777777-7777-4777-8777-777777777777',
      applicationId: '77777777-7777-4777-8777-777777777777',
      status: 'APPLIED',
      applicationUsedCvState: 'SELECTED',
      applicationUsedCvDocumentReference: {
        documentId: usedId,
        documentFamilyId: familyId,
        version: 2,
      },
      applicationUsedCoverLetterState: 'OMITTED',
    } as TrackedApplication;

    fixture.componentInstance.documentPanelToggled(
      application,
      {currentTarget: {open: true}} as unknown as Event,
    );
    const frozen = fixture.componentInstance.frozenVersion(application, 'CV');
    const artifact = fixture.componentInstance.availableArtifacts(frozen)[0];
    fixture.componentInstance.downloadExact(frozen!, artifact);

    expect(frozen?.documentId).toBe(usedId);
    expect(frozen?.documentId).not.toBe(laterId);
    expect(documentGeneration.downloadArtifact).toHaveBeenCalledWith(usedId, artifact);
  });
});
