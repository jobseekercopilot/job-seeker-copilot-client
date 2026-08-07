import {TestBed} from '@angular/core/testing';
import {of, Subject, throwError} from 'rxjs';
import {DocumentsWorkspaceComponent} from './documents-workspace.component';
import {ApplicationTrackerService} from '../../services/application-tracker.service';
import {DocumentGenerationService} from '../../services/document-generation.service';
import {DocumentLifecycleService} from '../../services/document-lifecycle.service';
import {DocumentFamilyHistoryResponse} from '../../api/document-generation-gateway';

const FAMILY_ID = '11111111-1111-4111-8111-111111111111';
const CURRENT_ID = '22222222-2222-4222-8222-222222222222';
const HISTORIC_ID = '33333333-3333-4333-8333-333333333333';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const ARTIFACT_ID = '55555555-5555-4555-8555-555555555555';

describe('DocumentsWorkspaceComponent', () => {
  const applicationTracker = {
    listApplications: vi.fn(() => of([{
      id: APPLICATION_ID,
      applicationId: APPLICATION_ID,
      canonicalJobId: 'job-1',
      jobTitle: 'Platform engineer',
      companyName: 'Example Ltd',
      status: 'DOCUMENTS_GENERATED',
    }])),
  };
  const documentGeneration = {
    downloadArtifact: vi.fn(() => Promise.resolve()),
  };
  const documentLifecycle = {
    allFamilies: vi.fn(() => of([family()])),
    history: vi.fn(() => of(history())),
    makeCurrent: vi.fn(() => of({currentDocumentId: HISTORIC_ID, currentVersion: 2})),
    archive: vi.fn(() => of({id: CURRENT_ID, retentionState: 'ARCHIVED'})),
    restore: vi.fn(() => of({id: CURRENT_ID, retentionState: 'AVAILABLE'})),
    delete: vi.fn(() => of(undefined)),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [DocumentsWorkspaceComponent],
      providers: [
        {provide: ApplicationTrackerService, useValue: applicationTracker},
        {provide: DocumentGenerationService, useValue: documentGeneration},
        {provide: DocumentLifecycleService, useValue: documentLifecycle},
      ],
    }).compileComponents();
  });

  it('builds one card from each authoritative family summary without inferring a version', () => {
    const fixture = TestBed.createComponent(DocumentsWorkspaceComponent);
    fixture.componentRef.setInput('enabled', true);
    fixture.detectChanges();

    expect(fixture.componentInstance.families()).toEqual([expect.objectContaining({
      documentFamilyId: FAMILY_ID,
      latestVersion: 7,
      currentVersion: 4,
      versionCount: 7,
    })]);
    expect(fixture.componentInstance.jobDetails(fixture.componentInstance.families()[0]))
      .toMatchObject({jobTitle: 'Platform engineer', companyName: 'Example Ltd'});
    expect(documentLifecycle.history).not.toHaveBeenCalled();
  });

  it('loads exact history lazily and orders rows by trusted version number', () => {
    const fixture = TestBed.createComponent(DocumentsWorkspaceComponent);
    fixture.componentRef.setInput('enabled', true);
    fixture.detectChanges();
    const familyView = fixture.componentInstance.families()[0];

    fixture.componentInstance.toggleFamily(familyView);

    expect(documentLifecycle.history).toHaveBeenCalledWith(FAMILY_ID);
    expect(fixture.componentInstance.versions(familyView).map(version => version.version))
      .toEqual([2, 1]);
  });

  it('distinguishes draft selections from submitted uses without duplicate counts', () => {
    const fixture = TestBed.createComponent(DocumentsWorkspaceComponent);
    fixture.componentRef.setInput('enabled', true);
    fixture.detectChanges();
    const familyView = fixture.componentInstance.families()[0];
    fixture.componentInstance.toggleFamily(familyView);

    expect(fixture.componentInstance.associationCount(familyView, 'DRAFT_SELECTED')).toBe(1);
    expect(fixture.componentInstance.associationCount(familyView, 'FROZEN_USED')).toBe(1);
  });

  it('offers downloads only for exact available artifacts and current selection only for approved available history', () => {
    const fixture = TestBed.createComponent(DocumentsWorkspaceComponent);
    const available = history().versions?.[0];
    const deleted = history().versions?.[1];

    expect(fixture.componentInstance.artifactLabel(available?.artifacts?.[0] ?? {}))
      .toBe('Download PDF');
    expect(fixture.componentInstance.artifactLabel(deleted?.artifacts?.[0] ?? {}))
      .toBeUndefined();
    expect(fixture.componentInstance.canMakeCurrent(available ?? {})).toBe(true);
    expect(fixture.componentInstance.canMakeCurrent(deleted ?? {})).toBe(false);
  });

  it('refreshes stale history and explains a current-selection conflict', () => {
    documentLifecycle.makeCurrent.mockReturnValueOnce(throwError(() => ({status: 409})));
    const fixture = TestBed.createComponent(DocumentsWorkspaceComponent);
    fixture.componentRef.setInput('enabled', true);
    fixture.detectChanges();
    const notices: {message: string}[] = [];
    fixture.componentInstance.notify.subscribe(notice => notices.push(notice));
    const familyView = fixture.componentInstance.families()[0];
    fixture.componentInstance.toggleFamily(familyView);

    fixture.componentInstance.makeCurrent(familyView, history().versions?.[0] ?? {});

    expect(documentLifecycle.history).toHaveBeenCalledTimes(2);
    expect(notices.at(-1)?.message).toContain('changed elsewhere');
  });

  it('ignores stale family-list responses from an older refresh', () => {
    const first = new Subject<ReturnType<typeof family>[]>();
    const second = new Subject<ReturnType<typeof family>[]>();
    documentLifecycle.allFamilies
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const fixture = TestBed.createComponent(DocumentsWorkspaceComponent);
    fixture.componentRef.setInput('enabled', true);
    fixture.detectChanges();

    fixture.componentInstance.refresh();
    second.next([{...family(), latestVersion: 9}]);
    second.complete();
    first.next([{...family(), latestVersion: 3}]);
    first.complete();

    expect(fixture.componentInstance.families()[0].latestVersion).toBe(9);
  });
});

function family() {
  return {
    documentFamilyId: FAMILY_ID,
    jobId: 'job-1',
    documentType: 'CV' as const,
    latestDocumentId: CURRENT_ID,
    latestVersion: 7,
    latestSource: 'GENERATED',
    latestLifecycle: 'APPROVED',
    latestRetention: 'AVAILABLE',
    currentDocumentId: CURRENT_ID,
    currentVersion: 4,
    versionCount: 7,
    createdAt: '2026-07-01T10:00:00Z',
    updatedAt: '2026-08-01T10:00:00Z',
  };
}

function history(): DocumentFamilyHistoryResponse {
  return {
    documentFamilyId: FAMILY_ID,
    jobId: 'job-1',
    documentType: 'CV' as const,
    currentDocumentId: CURRENT_ID,
    currentVersion: 1,
    versions: [
      {
        documentId: HISTORIC_ID,
        version: 2,
        source: 'UPLOADED',
        lifecycle: 'APPROVED',
        retention: 'AVAILABLE',
        current: false,
        createdAt: '2026-08-01T10:00:00Z',
        applicationAssociations: [
          {applicationId: APPLICATION_ID, associationState: 'DRAFT_SELECTED'},
          {applicationId: APPLICATION_ID, associationState: 'FROZEN_USED'},
        ],
        artifacts: [{
          artifactId: ARTIFACT_ID,
          role: 'DERIVED',
          format: 'PDF' as never,
          source: 'GENERATED',
          availability: 'AVAILABLE',
          size: 1200,
        }],
      },
      {
        documentId: CURRENT_ID,
        version: 1,
        source: 'GENERATED',
        lifecycle: 'APPROVED',
        retention: 'DELETED',
        current: false,
        purgeEligibleAt: '2026-09-01T10:00:00Z',
        applicationAssociations: [
          {applicationId: APPLICATION_ID, associationState: 'DRAFT_SELECTED'},
        ],
        artifacts: [{
          artifactId: ARTIFACT_ID,
          role: 'DERIVED',
          format: 'DOCX' as never,
          source: 'GENERATED',
          availability: 'UNAVAILABLE',
          size: 1200,
        }],
      },
    ],
  } as DocumentFamilyHistoryResponse;
}
