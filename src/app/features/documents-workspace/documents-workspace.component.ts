import {CommonModule} from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {forkJoin, of} from 'rxjs';
import {catchError} from 'rxjs/operators';
import {
  DocumentApplicationAssociation,
  DocumentArtifactManifestItem as ApiDocumentArtifact,
  DocumentFamilyHistoryResponse,
  DocumentFamilySummary,
  DocumentVersionHistoryItem,
} from '../../api/document-generation-gateway';
import {
  ApplicationTrackerService,
  TrackedApplication,
} from '../../services/application-tracker.service';
import {
  DocumentArtifactManifestItem,
  DocumentGenerationService,
  DocumentKind,
  documentArtifactDownloadLabel,
} from '../../services/document-generation.service';
import {
  DOCUMENT_LIFECYCLE_COPY,
  DocumentLifecycleService,
  associatedDocumentCopy,
  deletedDocumentCopy,
} from '../../services/document-lifecycle.service';

type DocumentFilter = 'ALL' | 'CV' | 'COVER_LETTER';
type DocumentSort = 'NEWEST' | 'OLDEST' | 'JOB_TITLE' | 'STATUS';

interface DocumentFamilyView {
  documentFamilyId: string;
  jobId: string;
  documentType: DocumentKind;
  latestDocumentId: string;
  latestVersion: number;
  latestSource: string;
  latestLifecycle: string;
  latestRetention: string;
  currentDocumentId?: string;
  currentVersion?: number;
  versionCount: number;
  createdAt?: string;
  updatedAt?: string;
}

@Component({
  selector: 'app-documents-workspace',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  host: {
    'data-demo-focus': 'app-documents-workspace',
    'data-demo-focus-id': 'documents-workspace',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './documents-workspace.component.html',
  styleUrl: './documents-workspace.component.css',
})
export class DocumentsWorkspaceComponent {
  private readonly applicationTracker = inject(ApplicationTrackerService);
  private readonly documentGeneration = inject(DocumentGenerationService);
  private readonly documentLifecycle = inject(DocumentLifecycleService);

  enabled = input(false);
  selectedApplicationId = input<string | null>(null);
  notify = output<{message: string; type: 'success' | 'info' | 'error'}>();
  applicationChanged = output<void>();
  openApplication = output<string>();

  families = signal<DocumentFamilyView[]>([]);
  applications = signal<TrackedApplication[]>([]);
  histories = signal<Record<string, DocumentFamilyHistoryResponse>>({});
  historyErrors = signal<Record<string, string>>({});
  historyLoadingId = signal<string | null>(null);
  selectedFamilyId = signal<string | null>(null);
  selectedFilter = signal<DocumentFilter>('ALL');
  selectedSort = signal<DocumentSort>('NEWEST');
  searchTerm = signal('');
  loading = signal(false);
  error = signal<string | null>(null);
  actingDocumentId = signal<string | null>(null);
  readonly lifecycleCopy = DOCUMENT_LIFECYCLE_COPY;
  private lastLoadKey = '';
  private refreshSequence = 0;

  readonly filterOptions: {key: DocumentFilter; label: string}[] = [
    {key: 'ALL', label: 'All document families'},
    {key: 'CV', label: 'CVs'},
    {key: 'COVER_LETTER', label: 'Cover letters'},
  ];

  readonly sortOptions: {key: DocumentSort; label: string}[] = [
    {key: 'NEWEST', label: 'Recently updated'},
    {key: 'OLDEST', label: 'Oldest updated'},
    {key: 'JOB_TITLE', label: 'Job title'},
    {key: 'STATUS', label: 'Lifecycle state'},
  ];

  filteredFamilies = computed(() => {
    const filter = this.selectedFilter();
    const query = this.searchTerm().trim().toLowerCase();
    return this.families()
      .filter(family => {
        const job = this.jobDetails(family);
        const haystack = [
          family.jobId,
          job?.jobTitle,
          job?.companyName,
          this.documentTypeLabel(family.documentType),
          this.sourceLabel(family.latestSource),
        ].join(' ').toLowerCase();
        return (filter === 'ALL' || family.documentType === filter)
          && (!query || haystack.includes(query));
      })
      .sort((left, right) => this.compareFamilies(left, right));
  });

  constructor() {
    effect(() => {
      if (this.enabled() && this.lastLoadKey !== 'enabled') {
        this.lastLoadKey = 'enabled';
        this.refresh();
      }
    });

    effect(() => {
      const applicationId = this.selectedApplicationId();
      const application = this.applications().find(candidate =>
        (candidate.applicationId ?? candidate.id) === applicationId);
      const familyId = application?.cvDocumentReference?.documentFamilyId
        ?? application?.coverLetterDocumentReference?.documentFamilyId
        ?? application?.applicationUsedCvDocumentReference?.documentFamilyId
        ?? application?.applicationUsedCoverLetterDocumentReference?.documentFamilyId;
      if (familyId && this.families().some(family => family.documentFamilyId === familyId)) {
        this.selectedFamilyId.set(familyId);
        this.loadHistory(familyId);
      }
    });
  }

  refresh(): void {
    const sequence = ++this.refreshSequence;
    if (!this.enabled()) {
      this.families.set([]);
      this.applications.set([]);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    forkJoin({
      families: this.documentLifecycle.allFamilies(),
      applications: this.applicationTracker.listApplications().pipe(catchError(() => of([]))),
    }).subscribe({
      next: ({families, applications}) => {
        if (sequence !== this.refreshSequence) return;
        this.families.set(families.flatMap(family => {
          const safe = this.familyView(family);
          return safe ? [safe] : [];
        }));
        this.applications.set(applications);
        const selected = this.selectedFamilyId();
        if (selected && !this.families().some(family => family.documentFamilyId === selected)) {
          this.selectedFamilyId.set(null);
        } else if (selected) {
          this.loadHistory(selected, true);
        }
        this.loading.set(false);
      },
      error: err => {
        if (sequence !== this.refreshSequence) return;
        this.loading.set(false);
        this.error.set('Could not load your document families. Please try again.');
        console.error('Document family workspace load failed:', err);
      },
    });
  }

  selectFilter(filter: DocumentFilter): void {
    this.selectedFilter.set(filter);
  }

  setSearchTerm(value: string): void {
    this.searchTerm.set(value);
  }

  toggleFamily(family: DocumentFamilyView): void {
    if (this.selectedFamilyId() === family.documentFamilyId) {
      this.selectedFamilyId.set(null);
      return;
    }
    this.selectedFamilyId.set(family.documentFamilyId);
    this.loadHistory(family.documentFamilyId);
  }

  collapseFamily(): void {
    this.selectedFamilyId.set(null);
  }

  @HostListener('document:keydown.escape')
  collapseFamilyOnEscape(): void {
    if (this.selectedFamilyId()) this.collapseFamily();
  }

  isExpanded(family: DocumentFamilyView): boolean {
    return this.selectedFamilyId() === family.documentFamilyId;
  }

  history(family: DocumentFamilyView): DocumentFamilyHistoryResponse | undefined {
    return this.histories()[family.documentFamilyId];
  }

  retryHistory(family: DocumentFamilyView): void {
    this.loadHistory(family.documentFamilyId, true);
  }

  versions(family: DocumentFamilyView): DocumentVersionHistoryItem[] {
    return [...(this.history(family)?.versions ?? [])]
      .sort((left, right) => (right.version ?? 0) - (left.version ?? 0));
  }

  countFor(filter: DocumentFilter): number {
    return this.families().filter(family =>
      filter === 'ALL' || family.documentType === filter).length;
  }

  associationCount(family: DocumentFamilyView, state: string): number {
    const ids = this.versions(family).flatMap(version =>
      (version.applicationAssociations ?? [])
        .filter(association => association.associationState === state)
        .flatMap(association => association.applicationId ? [association.applicationId] : []));
    return new Set(ids).size;
  }

  jobDetails(family: DocumentFamilyView): TrackedApplication | undefined {
    return this.applications().find(application =>
      application.canonicalJobId === family.jobId || application.jobId === family.jobId);
  }

  openAssociation(association: DocumentApplicationAssociation): void {
    if (association.applicationId) this.openApplication.emit(association.applicationId);
  }

  documentTypeLabel(type: DocumentKind): string {
    return type === 'CV' ? 'CV' : 'Cover letter';
  }

  sourceLabel(source: string | undefined): string {
    if (source === 'GENERATED') return 'AI-tailored';
    if (source === 'UPLOADED') return 'Uploaded';
    return 'Unknown source';
  }

  stateLabel(version: DocumentVersionHistoryItem): string {
    if (version.retention === 'PURGED') return 'Content no longer available';
    if (version.retention === 'DELETED') return 'Deleted';
    if (version.retention === 'ARCHIVED') return 'Archived';
    if (version.current) return 'Current';
    if (version.lifecycle === 'DRAFT') return 'Draft';
    return 'Historic';
  }

  statusClass(status: string | undefined | null): string {
    return `status-${(status ?? 'unknown').toLowerCase().replaceAll('_', '-')}`;
  }

  artifactLabel(artifact: ApiDocumentArtifact): string | undefined {
    const safe = this.downloadableArtifact(artifact);
    return safe ? documentArtifactDownloadLabel(safe) : undefined;
  }

  downloadArtifact(version: DocumentVersionHistoryItem, artifact: ApiDocumentArtifact): void {
    const safe = this.downloadableArtifact(artifact);
    if (!version.documentId || !safe) return;
    this.documentGeneration.downloadArtifact(version.documentId, safe).catch(err => {
      this.notify.emit({message: 'Download failed. Please try again.', type: 'error'});
      console.error('Exact document artifact download failed:', err);
    });
  }

  canMakeCurrent(version: DocumentVersionHistoryItem): boolean {
    return Boolean(
      version.documentId
      && version.lifecycle === 'APPROVED'
      && version.retention === 'AVAILABLE'
      && !version.current,
    );
  }

  makeCurrent(family: DocumentFamilyView, version: DocumentVersionHistoryItem): void {
    if (!version.documentId || !this.canMakeCurrent(version) || this.actingDocumentId()) return;
    this.actingDocumentId.set(version.documentId);
    this.documentLifecycle.makeCurrent(
      family.documentFamilyId,
      version.documentId,
      this.history(family)?.currentDocumentId,
    ).subscribe({
      next: () => {
        this.notify.emit({message: `Version ${version.version} is now current.`, type: 'success'});
        this.reloadAfterAction(family.documentFamilyId);
      },
      error: err => {
        const conflict = (err as {status?: number})?.status === 409;
        this.notify.emit({
          message: conflict
            ? 'The current version changed elsewhere. The latest history has been loaded; review it before retrying.'
            : 'The current version could not be changed. Please try again.',
          type: conflict ? 'info' : 'error',
        });
        this.loadHistory(family.documentFamilyId, true);
        this.actingDocumentId.set(null);
      },
    });
  }

  archiveVersion(family: DocumentFamilyView, version: DocumentVersionHistoryItem): void {
    if (!version.documentId || version.retention !== 'AVAILABLE' || this.actingDocumentId()) return;
    const warning = associatedDocumentCopy(version.applicationAssociations ?? []);
    if (!window.confirm([this.lifecycleCopy.archive, warning].filter(Boolean).join('\n\n'))) return;
    this.runLifecycleAction(
      family,
      version,
      this.documentLifecycle.archive(version.documentId),
      `Version ${version.version} archived.`,
    );
  }

  restoreVersion(family: DocumentFamilyView, version: DocumentVersionHistoryItem): void {
    if (
      !version.documentId
      || !['ARCHIVED', 'DELETED'].includes(version.retention ?? '')
      || this.actingDocumentId()
    ) return;
    this.runLifecycleAction(
      family,
      version,
      this.documentLifecycle.restore(version.documentId),
      `Version ${version.version} restored. It has not been made current.`,
    );
  }

  deleteVersion(family: DocumentFamilyView, version: DocumentVersionHistoryItem): void {
    if (
      !version.documentId
      || !['AVAILABLE', 'ARCHIVED'].includes(version.retention ?? '')
      || this.actingDocumentId()
    ) return;
    const warning = associatedDocumentCopy(version.applicationAssociations ?? []);
    const prompt = [
      warning,
      'Move this document to Deleted? Its files will be unavailable during the 30-day recovery period.',
      this.lifecycleCopy.irreversibleDeletion,
    ].filter(Boolean).join('\n\n');
    if (!window.confirm(prompt)) return;
    this.actingDocumentId.set(version.documentId);
    this.documentLifecycle.delete(version.documentId).subscribe({
      next: () => {
        this.notify.emit({message: `Version ${version.version} moved to Deleted.`, type: 'success'});
        this.reloadAfterAction(family.documentFamilyId);
      },
      error: err => this.actionFailed(err, family.documentFamilyId),
    });
  }

  deletedCopy(version: DocumentVersionHistoryItem): string | undefined {
    return version.retention === 'DELETED' && version.purgeEligibleAt
      ? deletedDocumentCopy(this.formatDate(version.purgeEligibleAt, true))
      : undefined;
  }

  formatDate(value: string | undefined | null, includeTime = false): string {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: includeTime ? '2-digit' : undefined,
      minute: includeTime ? '2-digit' : undefined,
    });
  }

  fileSize(size: number | undefined): string {
    if (size === undefined) return 'Unknown';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  familyFocusId(family: DocumentFamilyView): string {
    return `document-family-${family.documentFamilyId}`;
  }

  private loadHistory(documentFamilyId: string, force = false): void {
    if (!force && this.histories()[documentFamilyId]) return;
    this.historyLoadingId.set(documentFamilyId);
    this.historyErrors.update(errors => ({...errors, [documentFamilyId]: ''}));
    this.documentLifecycle.history(documentFamilyId).subscribe({
      next: history => {
        if (history.documentFamilyId !== documentFamilyId) {
          this.historyErrors.update(errors => ({
            ...errors,
            [documentFamilyId]: 'The document service returned mismatched history.',
          }));
        } else {
          this.histories.update(histories => ({...histories, [documentFamilyId]: history}));
        }
        if (this.historyLoadingId() === documentFamilyId) this.historyLoadingId.set(null);
      },
      error: err => {
        this.historyErrors.update(errors => ({
          ...errors,
          [documentFamilyId]: 'Could not load this version history. Please try again.',
        }));
        if (this.historyLoadingId() === documentFamilyId) this.historyLoadingId.set(null);
        console.error('Document family history load failed:', err);
      },
    });
  }

  private runLifecycleAction(
    family: DocumentFamilyView,
    version: DocumentVersionHistoryItem,
    action: ReturnType<DocumentLifecycleService['archive']>,
    message: string,
  ): void {
    this.actingDocumentId.set(version.documentId ?? null);
    action.subscribe({
      next: () => {
        this.notify.emit({message, type: 'success'});
        this.reloadAfterAction(family.documentFamilyId);
      },
      error: err => this.actionFailed(err, family.documentFamilyId),
    });
  }

  private actionFailed(error: unknown, documentFamilyId: string): void {
    const conflict = (error as {status?: number})?.status === 409;
    this.notify.emit({
      message: conflict
        ? 'This document changed elsewhere. The latest history has been loaded.'
        : 'The document could not be updated. Please try again.',
      type: conflict ? 'info' : 'error',
    });
    this.loadHistory(documentFamilyId, true);
    this.actingDocumentId.set(null);
  }

  private reloadAfterAction(documentFamilyId: string): void {
    this.actingDocumentId.set(null);
    this.loadHistory(documentFamilyId, true);
    this.documentLifecycle.allFamilies().subscribe(families => {
      this.families.set(families.flatMap(family => {
        const safe = this.familyView(family);
        return safe ? [safe] : [];
      }));
    });
    this.applicationChanged.emit();
  }

  private downloadableArtifact(
    artifact: ApiDocumentArtifact,
  ): DocumentArtifactManifestItem | undefined {
    if (
      !artifact.artifactId
      || !['ORIGINAL', 'DERIVED'].includes(artifact.role ?? '')
      || !['DOCX', 'PDF'].includes(artifact.format ?? '')
      || !['AVAILABLE', 'UNAVAILABLE'].includes(artifact.availability ?? '')
      || typeof artifact.size !== 'number'
    ) return undefined;
    return {
      artifactId: artifact.artifactId,
      role: artifact.role as DocumentArtifactManifestItem['role'],
      format: artifact.format as DocumentArtifactManifestItem['format'],
      source: artifact.source ?? 'UNKNOWN',
      availability: artifact.availability as DocumentArtifactManifestItem['availability'],
      size: artifact.size,
      storedAt: artifact.storedAt,
      createdAt: artifact.createdAt,
      updatedAt: artifact.updatedAt,
    };
  }

  private familyView(family: DocumentFamilySummary): DocumentFamilyView | undefined {
    if (
      !family.documentFamilyId
      || !family.jobId
      || !family.documentType
      || !family.latestDocumentId
      || !family.latestVersion
      || !family.latestSource
      || !family.latestLifecycle
      || !family.latestRetention
      || !family.versionCount
    ) return undefined;
    return {
      documentFamilyId: family.documentFamilyId,
      jobId: family.jobId,
      documentType: family.documentType,
      latestDocumentId: family.latestDocumentId,
      latestVersion: family.latestVersion,
      latestSource: family.latestSource,
      latestLifecycle: family.latestLifecycle,
      latestRetention: family.latestRetention,
      currentDocumentId: family.currentDocumentId,
      currentVersion: family.currentVersion,
      versionCount: family.versionCount,
      createdAt: family.createdAt,
      updatedAt: family.updatedAt,
    };
  }

  private compareFamilies(left: DocumentFamilyView, right: DocumentFamilyView): number {
    switch (this.selectedSort()) {
      case 'OLDEST':
        return this.time(left.updatedAt) - this.time(right.updatedAt);
      case 'JOB_TITLE':
        return (this.jobDetails(left)?.jobTitle ?? left.jobId)
          .localeCompare(this.jobDetails(right)?.jobTitle ?? right.jobId);
      case 'STATUS':
        return left.latestRetention.localeCompare(right.latestRetention);
      case 'NEWEST':
      default:
        return this.time(right.updatedAt) - this.time(left.updatedAt);
    }
  }

  private time(value: string | undefined): number {
    const parsed = value ? Date.parse(value) : 0;
    return Number.isNaN(parsed) ? 0 : parsed;
  }
}
