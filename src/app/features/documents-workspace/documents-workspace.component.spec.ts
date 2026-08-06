import { DocumentsWorkspaceComponent } from './documents-workspace.component';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import {
  ApplicationTrackerService,
  TrackedApplication,
} from '../../services/application-tracker.service';
import { DocumentGenerationService } from '../../services/document-generation.service';

describe('DocumentsWorkspaceComponent document actions', () => {
  const component = Object.create(DocumentsWorkspaceComponent.prototype) as DocumentsWorkspaceComponent;

  const document = (status: string, overrides: Record<string, unknown> = {}) => ({
    applicationId: 'application-1',
    documentId: 'document-1',
    status,
    ...overrides,
  });

  it('allows replacement and withdrawal while generated documents remain editable', () => {
    const generated = document('DOCUMENTS_GENERATED');

    expect(component.canReplace(generated as never)).toBe(true);
    expect(component.canDelete(generated as never)).toBe(true);
  });

  it.each([
    'APPLIED',
    'INTERVIEW',
    'OFFER',
    'ACCEPTED',
    'UNSUCCESSFUL',
    'WITHDRAWN',
  ])('locks replacement and withdrawal after the generated-document stage (%s)', status => {
    const locked = document(status);

    expect(component.canReplace(locked as never)).toBe(false);
    expect(component.canDelete(locked as never)).toBe(false);
  });

  it('requires persisted document and application identifiers for replacement', () => {
    expect(component.canReplace(document('DOCUMENTS_GENERATED', {
      documentId: '',
    }) as never)).toBe(false);
    expect(component.canReplace(document('DOCUMENTS_GENERATED', {
      applicationId: '',
    }) as never)).toBe(false);
  });

  it('requires a persisted application identifier for withdrawal', () => {
    expect(component.canDelete(document('DOCUMENTS_GENERATED', {
      applicationId: '',
    }) as never)).toBe(false);
  });
});

describe('DocumentsWorkspaceComponent authoritative refreshes', () => {
  let applicationResponses: Subject<TrackedApplication[]>[];
  const applicationTracker = {
    listApplications: vi.fn(() => applicationResponses.shift() ?? of([])),
  };
  const documentGeneration = {
    latestFiles: vi.fn(() => of({})),
    latestFileMetadata: vi.fn(() => of([])),
    allFileMetadata: vi.fn(() => of([])),
    uploadReplacement: vi.fn(),
    withdrawGeneratedApplication: vi.fn(),
    isDocx: vi.fn(() => true),
    download: vi.fn(),
  };

  beforeEach(async () => {
    applicationResponses = [];
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [DocumentsWorkspaceComponent],
      providers: [
        {provide: ApplicationTrackerService, useValue: applicationTracker},
        {provide: DocumentGenerationService, useValue: documentGeneration},
      ],
    }).compileComponents();
  });

  it('ignores stale list and hydration responses from an older refresh', () => {
    const first = new Subject<TrackedApplication[]>();
    const second = new Subject<TrackedApplication[]>();
    applicationResponses = [first, second];
    const fixture = TestBed.createComponent(DocumentsWorkspaceComponent);
    fixture.componentRef.setInput('enabled', true);
    fixture.detectChanges();

    fixture.componentInstance.refresh();
    second.next([application('new', 'new-cv')]);
    first.next([application('old', 'old-cv')]);

    expect(fixture.componentInstance.documents().map(item => item.documentId))
      .toEqual(['new-cv']);
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it('keeps current documents on accepted replacement and requests one parent refresh', async () => {
    applicationResponses = [new Subject<TrackedApplication[]>()];
    documentGeneration.uploadReplacement.mockResolvedValueOnce({
      processing: true,
      retryable: true,
      operationStatus: 'PROCESSING',
    });
    const fixture = TestBed.createComponent(DocumentsWorkspaceComponent);
    fixture.componentRef.setInput('enabled', true);
    fixture.detectChanges();
    const changed = vi.fn();
    fixture.componentInstance.applicationChanged.subscribe(changed);
    const current = {
      applicationId: 'application-1',
      documentId: 'document-1',
      documentType: 'CV',
      status: 'DOCUMENTS_GENERATED',
    } as never;
    fixture.componentInstance.documents.set([current]);
    const file = new File(['safe'], 'replacement.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    fixture.componentInstance.onReplacementSelected(current, {
      target: {files: [file], value: 'replacement.docx'},
    } as unknown as Event);
    await Promise.resolve();

    expect(fixture.componentInstance.documents()).toEqual([current]);
    expect(changed).toHaveBeenCalledOnce();
    expect(applicationTracker.listApplications).toHaveBeenCalledOnce();
  });

  it('applies a completed replacement locally before the parent refresh', async () => {
    applicationResponses = [new Subject<TrackedApplication[]>()];
    documentGeneration.uploadReplacement.mockResolvedValueOnce({
      processing: false,
      version: 3,
      latestFiles: {
        docx: {fileId: 'new-file'},
      },
    });
    const fixture = TestBed.createComponent(DocumentsWorkspaceComponent);
    fixture.componentRef.setInput('enabled', true);
    fixture.detectChanges();
    const current = {
      applicationId: 'application-1',
      documentId: 'document-1',
      documentType: 'CV',
      version: 2,
      status: 'DOCUMENTS_GENERATED',
    } as never;
    fixture.componentInstance.documents.set([current]);
    const file = new File(['safe'], 'replacement.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    fixture.componentInstance.onReplacementSelected(current, {
      target: {files: [file], value: 'replacement.docx'},
    } as unknown as Event);
    await Promise.resolve();

    expect(fixture.componentInstance.documents()[0]).toMatchObject({
      documentId: 'document-1',
      version: 3,
      downloads: {docx: {fileId: 'new-file'}},
    });
    expect(applicationTracker.listApplications).toHaveBeenCalledOnce();
  });

  function application(id: string, cvDocumentId: string): TrackedApplication {
    return {
      id,
      applicationId: id,
      cvDocumentId,
      jobTitle: `${id} role`,
      status: 'DOCUMENTS_GENERATED',
    };
  }
});
