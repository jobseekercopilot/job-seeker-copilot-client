import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, OnInit, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { finalize, forkJoin, map, of, switchMap } from 'rxjs';
import {
  ApplicationEvent,
  ApplicationFilter,
  ApplicationTrackerService,
  TrackedApplication,
} from '../../services/application-tracker.service';
import {
  DocumentFileMetadata,
  DocumentGenerationService,
  DocumentKind,
  documentArtifactDownloadLabel,
} from '../../services/document-generation.service';
import {
  DocumentArtifactManifestItem,
  DocumentFamilySummary,
  DocumentVersionHistoryItem,
} from '../../api/document-generation-gateway';
import { DocumentVersionReference } from '../../api/job-finder';
import {
  ApplicationDocumentSelectionConflict,
  ApplicationDocumentSelectionService,
  ApplicationSelectionRecord,
} from '../../services/application-document-selection.service';
import {DocumentLifecycleService} from '../../services/document-lifecycle.service';

type StatusUpdateTarget =
  | 'DOCUMENTS_GENERATED'
  | 'APPLIED'
  | 'INTERVIEW'
  | 'UNSUCCESSFUL'
  | 'OFFER'
  | 'ACCEPTED'
  | 'REJECTED_BY_USER'
  | 'WITHDRAWN';

interface FilterOption {
  key: ApplicationFilter;
  label: string;
}

interface TimelineStep {
  key: string;
  label: string;
  completedAt?: string;
}

interface EvidenceUsedReference {
  label: string;
  reference: DocumentVersionReference;
}

type DocumentSlot = 'CV' | 'COVER_LETTER';

interface DocumentVersionChoice extends DocumentVersionHistoryItem {
  documentId: string;
  documentFamilyId: string;
  documentType: DocumentSlot;
  version: number;
}

interface ApplicationDocumentPanel {
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  error?: string;
  message?: string;
  cvSelection: string;
  coverLetterSelection: string;
  options: DocumentVersionChoice[];
}

export function latestUserUploadTimestamp(metadata: DocumentFileMetadata[]): string | undefined {
  return metadata
    .filter(file => file.source?.toUpperCase() === 'USER_UPLOADED')
    .map(file => file.updatedAt ?? file.createdAt)
    .filter((value): value is string => Boolean(value))
    .filter(value => !Number.isNaN(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

function latestTimestamp(left: string | undefined, right: string): string {
  if (!left || Number.isNaN(Date.parse(left))) return right;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

@Component({
  selector: 'app-my-applications',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  host: {
    'data-demo-focus': 'app-my-applications',
    'data-demo-focus-id': 'applications-workspace'
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './my-applications.component.html',
  styleUrl: './my-applications.component.css',
})
export class MyApplicationsComponent implements OnInit {
  private readonly applicationTracker = inject(ApplicationTrackerService);
  private readonly documentGenerationService = inject(DocumentGenerationService);
  private readonly documentSelections = inject(ApplicationDocumentSelectionService);
  private readonly documentLifecycle = inject(DocumentLifecycleService);

  userId = input<string>('');
  authToken = input<string>('');
  selectedApplicationId = input<string | null>(null);
  notify = output<{ message: string; type: 'success' | 'info' | 'error' }>();
  applicationChanged = output<void>();

  applications = signal<TrackedApplication[]>([]);
  selectedFilter = signal<ApplicationFilter>('ALL');
  loading = signal(false);
  error = signal<string | null>(null);
  documentPanels = signal<Record<string, ApplicationDocumentPanel | undefined>>({});
  uploadingDocuments = signal<Record<string, DocumentKind | undefined>>({});
  updatingStatuses = signal<Record<string, StatusUpdateTarget | undefined>>({});
  private readonly selectionIdempotencyKeys = new Map<string, string>();
  private refreshSequence = 0;

  readonly filters: FilterOption[] = [
    { key: 'ALL', label: 'All' },
    { key: 'NEEDS_ACTION', label: 'Needs Action' },
    { key: 'APPLIED', label: 'Applied' },
    { key: 'INTERVIEW', label: 'Interview' },
    { key: 'OFFERS', label: 'Offers' },
    { key: 'ARCHIVED', label: 'Archived' },
  ];

  filteredApplications = computed(() => {
    const selected = this.selectedFilter();
    return this.applications()
      .filter(application => this.matchesFilter(application, selected))
      .sort((left, right) => this.time(right.updatedAt ?? right.createdAt) - this.time(left.updatedAt ?? left.createdAt));
  });

  constructor() {
    effect(() => {
      const applicationId = this.selectedApplicationId();
      if (applicationId) {
        this.selectedFilter.set('ALL');
      }
    });
  }

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    const requestSequence = ++this.refreshSequence;
    this.loading.set(true);
    this.error.set(null);
    this.applicationTracker.listApplications().subscribe({
      next: applications => {
        if (requestSequence !== this.refreshSequence) return;
        this.applications.set(applications);
        this.loading.set(false);
        this.loadUploadHistory(applications, requestSequence);
      },
      error: err => {
        if (requestSequence !== this.refreshSequence) return;
        this.loading.set(false);
        this.error.set('Could not load saved applications. Please try again.');
        console.error('Application list load failed:', err);
      },
    });
  }

  selectFilter(filter: ApplicationFilter): void {
    this.selectedFilter.set(filter);
  }

  countFor(filter: ApplicationFilter): number {
    return this.applications().filter(application => this.matchesFilter(application, filter)).length;
  }

  statusLabel(status: string | undefined | null): string {
    if (!status) return 'Unknown';
    if (status === 'SAVED') return 'Saved to applications';
    if (status === 'DOCUMENTS_GENERATED') return 'Documents prepared';
    if (status === 'REJECTED_BY_USER') return 'Offer declined';
    return status.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
  }

  statusClass(application: TrackedApplication): string {
    return `status-${(application.status ?? 'unknown').toLowerCase().replaceAll('_', '-')}`;
  }

  sourceText(application: TrackedApplication): string {
    return application.providerName || application.source || application.provider || 'Saved application';
  }

  postedDate(application: TrackedApplication): string | null {
    return application.postedAt ?? application.postedDate ?? null;
  }

  createdDate(application: TrackedApplication): string | null {
    return application.createdAt ?? application.updatedAt ?? null;
  }

  interviewDate(application: TrackedApplication): string | null {
    if (application.interviewAt) return application.interviewAt;
    return application.status === 'INTERVIEW' ? application.updatedAt ?? null : null;
  }

  offerDate(application: TrackedApplication): string | null {
    if (application.offerAt) return application.offerAt;
    return application.status === 'OFFER' ? application.updatedAt ?? null : null;
  }

  documentState(application: TrackedApplication): string {
    const hasCv = !!application.cvDocumentId;
    const hasLetter = !!application.coverLetterDocumentId;
    if (hasCv && hasLetter) return 'CV and cover letter saved';
    if (hasCv) return 'CV saved';
    if (hasLetter) return 'Cover letter saved';
    return 'No documents saved';
  }

  evidenceReferences(application: TrackedApplication): EvidenceUsedReference[] {
    const frozen = !this.canEditDocumentSelections(application);
    const cv = frozen
      ? application.applicationUsedCvState === 'SELECTED'
        ? application.applicationUsedCvDocumentReference
        : undefined
      : application.cvDocumentReference;
    const coverLetter = frozen
      ? application.applicationUsedCoverLetterState === 'SELECTED'
        ? application.applicationUsedCoverLetterDocumentReference
        : undefined
      : application.coverLetterDocumentReference;
    return [
      cv ? { label: 'CV', reference: cv } : undefined,
      coverLetter ? { label: 'Cover letter', reference: coverLetter } : undefined,
    ].filter((item): item is EvidenceUsedReference => Boolean(item));
  }

  evidenceScopeText(application: TrackedApplication): string {
    if (!this.canEditDocumentSelections(application)) {
      return application.applicationUsedAt
        ? `Frozen when applied ${this.formatDate(application.applicationUsedAt, true)}`
        : 'Frozen when this application was submitted';
    }
    return 'Selected for the current document drafts';
  }

  compactReference(value: string | undefined): string {
    if (!value) return 'Not recorded';
    return value.length > 12
      ? `${value.slice(0, 8)}…${value.slice(-4)}`
      : value;
  }

  evidenceCount(reference: DocumentVersionReference): number {
    return reference.evidenceProvenance?.evidenceRevisions?.length ?? 0;
  }

  evidenceSections(reference: DocumentVersionReference): string {
    const sections = reference.evidenceProvenance?.sectionOrder ?? [];
    return sections.length
      ? sections.map(section => this.statusLabel(section)).join(', ')
      : 'Not recorded';
  }

  groundingLabel(reference: DocumentVersionReference): string {
    switch (reference.groundingState) {
      case 'AI_GENERATED_EVIDENCE_VALIDATED':
        return 'Sources validated';
      case 'USER_EDITED_REVALIDATED':
        return 'Edit revalidated';
      case 'USER_EDITED_REVIEW_REQUIRED':
        return 'Review required';
      default:
        return 'Legacy provenance';
    }
  }

  groundingNeedsReview(reference: DocumentVersionReference): boolean {
    return reference.groundingState === 'USER_EDITED_REVIEW_REQUIRED';
  }

  canEditDocumentSelections(application: TrackedApplication): boolean {
    return application.status === 'SAVED'
      || application.status === 'DOCUMENTS_GENERATED';
  }

  documentPanel(application: TrackedApplication): ApplicationDocumentPanel {
    return this.documentPanels()[this.applicationId(application)] ?? {
      loaded: false,
      loading: false,
      saving: false,
      cvSelection: application.cvDocumentReference?.documentId
        ?? application.cvDocumentId
        ?? '',
      coverLetterSelection: application.coverLetterDocumentReference?.documentId
        ?? application.coverLetterDocumentId
        ?? '',
      options: [],
    };
  }

  documentPanelToggled(application: TrackedApplication, event: Event): void {
    const details = event.currentTarget as HTMLDetailsElement;
    if (!details.open || this.documentPanel(application).loaded
      || this.documentPanel(application).loading) return;

    if (this.canEditDocumentSelections(application)) {
      this.loadEditableDocumentOptions(application);
    } else {
      this.loadFrozenDocumentOptions(application);
    }
  }

  documentOptions(
    application: TrackedApplication,
    documentType: DocumentSlot,
  ): DocumentVersionChoice[] {
    return this.documentPanel(application).options
      .filter(option => option.documentType === documentType);
  }

  hasDocumentOption(
    application: TrackedApplication,
    documentType: DocumentSlot,
    documentId: string,
  ): boolean {
    return this.documentOptions(application, documentType)
      .some(option => option.documentId === documentId);
  }

  selectionsEligible(application: TrackedApplication): boolean {
    const panel = this.documentPanel(application);
    return (!panel.cvSelection
        || this.hasDocumentOption(application, 'CV', panel.cvSelection))
      && (!panel.coverLetterSelection
        || this.hasDocumentOption(application, 'COVER_LETTER', panel.coverLetterSelection));
  }

  optionLabel(option: DocumentVersionChoice): string {
    const source = option.source
      ? this.statusLabel(option.source)
      : 'Trusted document';
    const date = this.formatDate(option.approvedAt ?? option.createdAt);
    return [
      option.title || `${option.documentType === 'CV' ? 'CV' : 'Cover letter'} version ${option.version}`,
      `Version ${option.version}`,
      source,
      date,
      option.current ? 'Recommended' : '',
    ].filter(Boolean).join(' · ');
  }

  selectionChanged(
    application: TrackedApplication,
    documentType: DocumentSlot,
    event: Event,
  ): void {
    const value = (event.target as HTMLSelectElement).value;
    this.updateDocumentPanel(application, panel => ({
      ...panel,
      ...(documentType === 'CV'
        ? {cvSelection: value}
        : {coverLetterSelection: value}),
      error: undefined,
      message: undefined,
    }));
  }

  saveDocumentSelections(application: TrackedApplication): void {
    const applicationId = this.applicationId(application);
    const panel = this.documentPanel(application);
    const version = application.version;
    if (!this.canEditDocumentSelections(application)
      || panel.saving
      || !panel.loaded
      || !this.selectionsEligible(application)
      || !Number.isSafeInteger(version)) return;

    const signature = [
      applicationId,
      version,
      panel.cvSelection || 'OMITTED',
      panel.coverLetterSelection || 'OMITTED',
    ].join(':');
    const idempotencyKey = this.selectionIdempotencyKeys.get(signature)
      ?? `browser-${crypto.randomUUID()}`;
    this.selectionIdempotencyKeys.set(signature, idempotencyKey);
    this.updateDocumentPanel(application, current => ({
      ...current,
      saving: true,
      error: undefined,
      message: undefined,
    }));

    try {
      this.documentSelections.saveSelections(applicationId, {
        cvSelection: panel.cvSelection
          ? this.documentSelections.selected(panel.cvSelection)
          : this.documentSelections.omitted(),
        coverLetterSelection: panel.coverLetterSelection
          ? this.documentSelections.selected(panel.coverLetterSelection)
          : this.documentSelections.omitted(),
        expectedVersion: version as number,
      }, idempotencyKey).pipe(
        finalize(() => this.updateDocumentPanel(application, current => ({
          ...current,
          saving: false,
        }))),
      ).subscribe({
        next: record => {
          this.selectionIdempotencyKeys.delete(signature);
          this.applySelectionRecord(application, record);
          this.updateDocumentPanel(application, current => ({
            ...current,
            cvSelection: record.cvDocumentReference?.documentId ?? '',
            coverLetterSelection: record.coverLetterDocumentReference?.documentId ?? '',
            message: 'Exact document selections saved.',
          }));
          this.notify.emit({message: 'Application documents saved.', type: 'success'});
          this.applicationChanged.emit();
        },
        error: error => this.handleSelectionSaveError(application, error),
      });
    } catch (error) {
      this.updateDocumentPanel(application, current => ({
        ...current,
        saving: false,
        error: error instanceof Error ? error.message : 'Could not save document selections.',
      }));
    }
  }

  frozenState(application: TrackedApplication, documentType: DocumentSlot): string {
    return documentType === 'CV'
      ? application.applicationUsedCvState ?? 'UNKNOWN'
      : application.applicationUsedCoverLetterState ?? 'UNKNOWN';
  }

  frozenReference(
    application: TrackedApplication,
    documentType: DocumentSlot,
  ): DocumentVersionReference | undefined {
    return documentType === 'CV'
      ? application.applicationUsedCvDocumentReference
      : application.applicationUsedCoverLetterDocumentReference;
  }

  frozenSlotText(application: TrackedApplication, documentType: DocumentSlot): string {
    const label = documentType === 'CV' ? 'CV' : 'Cover letter';
    const state = this.frozenState(application, documentType);
    if (state === 'OMITTED') {
      return documentType === 'CV' ? 'No CV used' : 'No cover letter used';
    }
    if (state !== 'SELECTED') return `${label} used is unknown for this legacy application`;
    const reference = this.frozenReference(application, documentType);
    return reference?.version
      ? `${label} used · Version ${reference.version}`
      : `${label} used · Exact version unavailable`;
  }

  frozenVersion(
    application: TrackedApplication,
    documentType: DocumentSlot,
  ): DocumentVersionChoice | undefined {
    const documentId = this.frozenReference(application, documentType)?.documentId;
    return documentId
      ? this.documentPanel(application).options.find(option => option.documentId === documentId)
      : undefined;
  }

  availableArtifacts(version: DocumentVersionChoice | undefined): DocumentArtifactManifestItem[] {
    return (version?.artifacts ?? []).filter(artifact =>
      Boolean(documentArtifactDownloadLabel(artifact as Parameters<typeof documentArtifactDownloadLabel>[0]))
    );
  }

  artifactLabel(artifact: DocumentArtifactManifestItem): string {
    return documentArtifactDownloadLabel(
      artifact as Parameters<typeof documentArtifactDownloadLabel>[0],
    ) ?? 'Unavailable';
  }

  downloadExact(
    version: DocumentVersionChoice,
    artifact: DocumentArtifactManifestItem,
  ): void {
    this.documentGenerationService.downloadArtifact(
      version.documentId,
      artifact as Parameters<DocumentGenerationService['downloadArtifact']>[1],
    ).catch(error => {
      this.notify.emit({message: 'This exact document could not be downloaded.', type: 'error'});
      console.error('Exact application document download failed:', error);
    });
  }

  timeline(application: TrackedApplication): TimelineStep[] {
    const events = this.applicationTracker.eventsForApplication(application);
    const firstEvent = (type: ApplicationEvent['eventType']) => events.find(event => event.eventType === type)?.timestamp;
    return [
      { key: 'cv', label: 'CV Generated', completedAt: firstEvent('CV_GENERATED') },
      { key: 'letter', label: 'Cover Letter Generated', completedAt: firstEvent('COVER_LETTER_GENERATED') },
      { key: 'upload', label: 'Documents Uploaded', completedAt: firstEvent('DOCUMENTS_UPLOADED') },
      { key: 'applied', label: 'Mark Applied', completedAt: firstEvent('MARKED_APPLIED') },
      { key: 'interview', label: 'Interview', completedAt: firstEvent('INTERVIEW') },
      { key: 'offer', label: 'Offer', completedAt: firstEvent('OFFER') },
    ];
  }

  actions(application: TrackedApplication): { label: string; status: StatusUpdateTarget; danger?: boolean }[] {
    switch (application.status) {
      case 'SAVED':
        return [
          { label: 'Mark as Applied', status: 'APPLIED' },
        ];
      case 'DOCUMENTS_GENERATED':
        return [
          { label: 'Mark as Applied', status: 'APPLIED' },
          { label: 'Withdraw', status: 'WITHDRAWN' },
        ];
      case 'APPLIED':
        return [
          { label: 'Mark Interview', status: 'INTERVIEW' },
          { label: 'Mark Offer', status: 'OFFER' },
          { label: 'Mark Unsuccessful', status: 'UNSUCCESSFUL', danger: true },
        ];
      case 'INTERVIEW':
        return [
          { label: 'Mark Offer', status: 'OFFER' },
          { label: 'Mark Unsuccessful', status: 'UNSUCCESSFUL', danger: true },
        ];
      case 'OFFER':
        return [
          { label: 'Mark Offer', status: 'OFFER' },
          { label: 'Mark Unsuccessful', status: 'UNSUCCESSFUL', danger: true },
        ];
      default:
        return [];
    }
  }

  canUploadDocuments(application: TrackedApplication): boolean {
    return Boolean(
      this.applicationId(application)
      && application.status === 'DOCUMENTS_GENERATED'
    );
  }

  onFileSelected(application: TrackedApplication, kind: DocumentKind, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.canUploadDocuments(application)) return;
    if (!this.documentGenerationService.isDocx(file)) {
      this.notify.emit({ message: 'Please upload a Microsoft Word .docx file.', type: 'error' });
      return;
    }

    const applicationId = this.applicationId(application);
    if (!applicationId) {
      this.notify.emit({ message: 'Application id is missing.', type: 'error' });
      return;
    }

    this.uploadingDocuments.update(uploading => ({ ...uploading, [applicationId]: kind }));
    this.documentGenerationService.uploadReplacement(
      applicationId,
      file,
      kind,
    ).then(response => {
      if (response.processing) {
        this.notify.emit({
          message: response.retryable
            ? 'Document replacement was not completed. Your current document has been kept; try the replacement again.'
            : (response.message || 'Document replacement needs recovery. Your current document has been kept.'),
          type: 'info',
        });
        this.applicationChanged.emit();
        return;
      }
      this.applications.update(applications => applications.map(item =>
        this.applicationId(item) === applicationId
          ? {
              ...item,
              cvDocumentId: response.cvDocumentId ?? item.cvDocumentId,
              coverLetterDocumentId: response.coverLetterDocumentId ?? item.coverLetterDocumentId,
              documentsUploadedAt: new Date().toISOString(),
            }
          : item
      ));
      this.notify.emit({ message: response.message || 'Document replaced successfully. PDF version has been updated.', type: 'success' });
      this.applicationChanged.emit();
    }).catch(err => {
      const message = err instanceof Error ? err.message : 'Upload failed. Please choose a DOCX file under 25MB.';
      this.notify.emit({ message, type: 'error' });
      console.error('Application document upload failed:', err);
    }).finally(() => {
      this.uploadingDocuments.update(uploading => ({ ...uploading, [applicationId]: undefined }));
    });
  }

  updateStatus(application: TrackedApplication, status: StatusUpdateTarget): void {
    const applicationId = this.applicationId(application);
    if (!applicationId || this.updatingStatuses()[applicationId]) return;

    if (status === 'WITHDRAWN') {
      this.withdraw(application);
      return;
    }

    this.updatingStatuses.update(updating => ({ ...updating, [applicationId]: status }));
    this.applicationTracker.updateStatus(applicationId, status).pipe(
      finalize(() => this.updatingStatuses.update(updating => ({
        ...updating,
        [applicationId]: undefined,
      }))),
    ).subscribe({
      next: record => {
        this.upsert(record);
        this.notify.emit({ message: `Application updated to ${this.statusLabel(record.status)}.`, type: 'success' });
        this.applicationChanged.emit();
      },
      error: err => {
        this.notify.emit({ message: 'Could not update application status. Please try again.', type: 'error' });
        console.error('Application workspace status update failed:', err);
      },
    });
  }

  formatDate(value: string | undefined | null, includeTime = false): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: includeTime ? undefined : 'numeric',
      hour: includeTime ? '2-digit' : undefined,
      minute: includeTime ? '2-digit' : undefined,
    });
  }

  applicationId(application: TrackedApplication): string {
    return application.applicationId
      ?? application.id
      ?? `${application.jobTitle ?? 'application'}-${application.companyName ?? 'company'}`;
  }

  applicationFocusId(application: TrackedApplication): string {
    return `application-${this.slug(this.applicationId(application))}`;
  }

  applicationFocusGroup(application: TrackedApplication): string {
    return this.applicationFocusId(application);
  }

  isUpdating(application: TrackedApplication): boolean {
    return !!this.updatingStatuses()[this.applicationId(application)];
  }

  isUploading(application: TrackedApplication, kind: DocumentKind): boolean {
    return this.uploadingDocuments()[this.applicationId(application)] === kind;
  }

  isSelected(application: TrackedApplication): boolean {
    return this.selectedApplicationId() === this.applicationId(application);
  }

  private loadEditableDocumentOptions(application: TrackedApplication): void {
    const jobId = application.canonicalJobId ?? application.jobId;
    this.updateDocumentPanel(application, panel => ({
      ...panel,
      loading: true,
      error: undefined,
    }));
    this.documentLifecycle.allFamilies().pipe(
      map(families => families.filter(family =>
        Boolean(family.documentFamilyId)
        && family.jobId === jobId
        && (family.documentType === 'CV' || family.documentType === 'COVER_LETTER')
      )),
      switchMap(families => families.length
        ? forkJoin(families.map(family => this.documentLifecycle.history(
          family.documentFamilyId as string,
        ).pipe(map(history => ({family, history})))))
        : of([])),
      map(histories => histories.flatMap(({family, history}) =>
        (history.versions ?? [])
          .filter(version => version.lifecycle === 'APPROVED'
            && version.retention === 'AVAILABLE')
          .map(version => this.versionChoice(family, version))
          .filter((version): version is DocumentVersionChoice => Boolean(version))
      )),
      map(options => options.sort((left, right) =>
        Number(right.current) - Number(left.current)
        || this.time(right.approvedAt ?? right.createdAt)
          - this.time(left.approvedAt ?? left.createdAt)
        || right.version - left.version
      )),
    ).subscribe({
      next: options => this.updateDocumentPanel(application, panel => ({
        ...panel,
        options,
        loaded: true,
        loading: false,
      })),
      error: error => {
        this.updateDocumentPanel(application, panel => ({
          ...panel,
          loaded: false,
          loading: false,
          error: 'Could not load approved document versions. Please try again.',
        }));
        console.error('Application document options load failed:', error);
      },
    });
  }

  private loadFrozenDocumentOptions(application: TrackedApplication): void {
    const families = (['CV', 'COVER_LETTER'] as const)
      .map(documentType => ({
        documentType,
        documentFamilyId: this.frozenReference(application, documentType)?.documentFamilyId,
      }))
      .filter((family): family is {documentType: DocumentSlot; documentFamilyId: string} =>
        Boolean(family.documentFamilyId)
      );
    this.updateDocumentPanel(application, panel => ({
      ...panel,
      loading: true,
      error: undefined,
    }));
    const uniqueFamilies = families.filter((family, index) =>
      families.findIndex(candidate => candidate.documentFamilyId === family.documentFamilyId) === index
    );
    (uniqueFamilies.length
      ? forkJoin(uniqueFamilies.map(family => this.documentLifecycle.history(
        family.documentFamilyId,
      ).pipe(map(history => ({family, history})))))
      : of([])
    ).pipe(
      map(histories => histories.flatMap(({family, history}) =>
        (history.versions ?? [])
          .map(version => this.versionChoice({
            documentFamilyId: family.documentFamilyId,
            documentType: family.documentType,
          }, version))
          .filter((version): version is DocumentVersionChoice => Boolean(version))
      )),
    ).subscribe({
      next: options => this.updateDocumentPanel(application, panel => ({
        ...panel,
        options,
        loaded: true,
        loading: false,
      })),
      error: error => {
        this.updateDocumentPanel(application, panel => ({
          ...panel,
          loaded: true,
          loading: false,
          error: 'Exact document content is not available right now.',
        }));
        console.error('Frozen application document history load failed:', error);
      },
    });
  }

  private versionChoice(
    family: {
      documentFamilyId?: string;
      documentType?: DocumentFamilySummary['documentType'] | DocumentSlot;
      currentDocumentId?: string;
    },
    version: DocumentVersionHistoryItem,
  ): DocumentVersionChoice | undefined {
    if (!family.documentFamilyId
      || (family.documentType !== 'CV' && family.documentType !== 'COVER_LETTER')
      || !version.documentId
      || !Number.isSafeInteger(version.version)) return undefined;
    return {
      ...version,
      documentId: version.documentId,
      documentFamilyId: family.documentFamilyId,
      documentType: family.documentType,
      version: version.version as number,
      current: version.current ?? family.currentDocumentId === version.documentId,
    };
  }

  private updateDocumentPanel(
    application: TrackedApplication,
    update: (panel: ApplicationDocumentPanel) => ApplicationDocumentPanel,
  ): void {
    const applicationId = this.applicationId(application);
    this.documentPanels.update(panels => ({
      ...panels,
      [applicationId]: update(this.documentPanel(application)),
    }));
  }

  private applySelectionRecord(
    application: TrackedApplication,
    record: ApplicationSelectionRecord,
  ): void {
    this.upsert({
      ...application,
      ...record,
      applicationId: record.id,
    } as unknown as TrackedApplication);
  }

  private handleSelectionSaveError(
    application: TrackedApplication,
    error: unknown,
  ): void {
    if (error instanceof ApplicationDocumentSelectionConflict) {
      this.applySelectionRecord(application, error.currentApplication);
      this.updateDocumentPanel(application, panel => ({
        ...panel,
        cvSelection: error.currentApplication.cvDocumentReference?.documentId ?? '',
        coverLetterSelection:
          error.currentApplication.coverLetterDocumentReference?.documentId ?? '',
        error: 'This application changed elsewhere. The latest selections are shown; review them before saving again.',
      }));
      return;
    }
    this.updateDocumentPanel(application, panel => ({
      ...panel,
      error: 'Could not save document selections. Your choices are retained so you can try again.',
    }));
    console.error('Application document selection save failed:', error);
  }

  private withdraw(application: TrackedApplication): void {
    const applicationId = this.applicationId(application);
    this.updatingStatuses.update(updating => ({ ...updating, [applicationId]: 'WITHDRAWN' }));
    this.applicationTracker.withdrawGeneratedApplication(applicationId).pipe(
      finalize(() => this.updatingStatuses.update(updating => ({
        ...updating,
        [applicationId]: undefined,
      }))),
    ).subscribe({
      next: outcome => {
        if (outcome.processing) {
          this.notify.emit({
            message: outcome.retryable
              ? 'Withdrawal was not completed. The application has been retained; try again.'
              : (outcome.message || 'Withdrawal needs recovery. The application has been retained.'),
            type: 'info',
          });
          this.applicationChanged.emit();
          return;
        }
        this.applications.update(applications => applications.filter(item => this.applicationId(item) !== applicationId));
        this.notify.emit({ message: 'Generated application withdrawn.', type: 'success' });
        this.applicationChanged.emit();
      },
      error: err => {
        this.notify.emit({ message: 'Could not withdraw this application. Please try again.', type: 'error' });
        console.error('Application workspace withdraw failed:', err);
      },
    });
  }

  private upsert(record: TrackedApplication): void {
    const recordId = this.applicationId(record);
    this.applications.update(applications => applications.map(application =>
      this.applicationId(application) === recordId ? { ...application, ...record } : application
    ));
  }

  private loadUploadHistory(
    applications: TrackedApplication[],
    requestSequence: number,
  ): void {
    for (const application of applications) {
      const applicationId = this.applicationId(application);
      if (!applicationId) continue;
      if (application.cvDocumentId) {
        this.documentGenerationService.allFileMetadata(application.cvDocumentId).subscribe({
          next: metadata => {
            if (requestSequence === this.refreshSequence) {
              this.recordDocumentUpload(applicationId, metadata);
            }
          },
          error: err => console.warn('Could not load CV upload history for application:', err),
        });
      }
      if (application.coverLetterDocumentId) {
        this.documentGenerationService.allFileMetadata(application.coverLetterDocumentId).subscribe({
          next: metadata => {
            if (requestSequence === this.refreshSequence) {
              this.recordDocumentUpload(applicationId, metadata);
            }
          },
          error: err => console.warn('Could not load cover letter upload history for application:', err),
        });
      }
    }
  }

  private recordDocumentUpload(applicationId: string, metadata: DocumentFileMetadata[]): void {
    const uploadedAt = latestUserUploadTimestamp(metadata);
    if (!uploadedAt) return;

    this.applications.update(applications => applications.map(application =>
      this.applicationId(application) === applicationId
        ? {
            ...application,
            documentsUploadedAt: latestTimestamp(application.documentsUploadedAt, uploadedAt),
          }
        : application
    ));
  }

  private matchesFilter(application: TrackedApplication, filter: ApplicationFilter): boolean {
    switch (filter) {
      case 'ALL':
        return true;
      case 'NEEDS_ACTION':
        return application.status === 'SAVED'
          || application.status === 'DOCUMENTS_GENERATED';
      case 'APPLIED':
        return application.status === 'APPLIED';
      case 'INTERVIEW':
        return application.status === 'INTERVIEW';
      case 'OFFERS':
        return application.status === 'OFFER';
      case 'ARCHIVED':
        return ['UNSUCCESSFUL', 'WITHDRAWN', 'REJECTED_BY_USER', 'ACCEPTED'].includes(application.status ?? '');
    }
  }

  private time(value: string | undefined | null): number {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
  }
}
