import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApplicationTrackerService, TrackedApplication } from '../../services/application-tracker.service';
import {
  DocumentFileMetadata,
  DocumentGenerationService,
  DocumentKind,
} from '../../services/document-generation.service';
import {
  DocumentDownloadsResponse,
  DownloadFileResponse,
} from '../../api/document-generation-gateway';

type DocumentFilter = 'ALL' | 'CV' | 'COVER_LETTER';
type DocumentSort = 'NEWEST' | 'OLDEST' | 'JOB_TITLE' | 'COMPANY' | 'STATUS';

interface ApplicationDocument {
  documentId: string;
  applicationId: string;
  canonicalJobId?: string;
  jobTitle?: string;
  companyName?: string;
  documentType: DocumentKind;
  documentTitle: string;
  createdAt?: string;
  updatedAt?: string;
  version: number;
  status?: string;
  appliedAt?: string;
  interviewAt?: string;
  fileSize?: number;
  downloads?: DocumentDownloadsResponse;
  metadata: DocumentFileMetadata[];
  application: TrackedApplication;
}

@Component({
  selector: 'app-documents-workspace',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  host: {
    'data-demo-focus': 'app-documents-workspace',
    'data-demo-focus-id': 'documents-workspace'
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './documents-workspace.component.html',
  styleUrl: './documents-workspace.component.css',
})
export class DocumentsWorkspaceComponent {
  private readonly applicationTracker = inject(ApplicationTrackerService);
  private readonly documentGenerationService = inject(DocumentGenerationService);

  enabled = input(false);
  selectedApplicationId = input<string | null>(null);
  notify = output<{ message: string; type: 'success' | 'info' | 'error' }>();
  applicationChanged = output<void>();
  openApplication = output<string>();

  documents = signal<ApplicationDocument[]>([]);
  selectedDocumentId = signal<string | null>(null);
  selectedFilter = signal<DocumentFilter>('ALL');
  selectedSort = signal<DocumentSort>('NEWEST');
  searchTerm = signal('');
  loading = signal(false);
  error = signal<string | null>(null);
  replacingDocumentId = signal<string | null>(null);
  deletingDocumentId = signal<string | null>(null);
  private lastLoadKey = '';

  readonly filterOptions: { key: DocumentFilter; label: string }[] = [
    { key: 'ALL', label: 'All Documents' },
    { key: 'CV', label: 'CVs' },
    { key: 'COVER_LETTER', label: 'Cover Letters' },
  ];

  readonly sortOptions: { key: DocumentSort; label: string }[] = [
    { key: 'NEWEST', label: 'Newest first' },
    { key: 'OLDEST', label: 'Oldest first' },
    { key: 'JOB_TITLE', label: 'Job Title' },
    { key: 'COMPANY', label: 'Company' },
    { key: 'STATUS', label: 'Status' },
  ];

  filteredDocuments = computed(() => {
    const filter = this.selectedFilter();
    const query = this.searchTerm().trim().toLowerCase();
    const filtered = this.documents().filter(document => {
      const matchesFilter = filter === 'ALL' || document.documentType === filter;
      const haystack = [
        document.jobTitle,
        document.companyName,
        this.documentTypeLabel(document.documentType),
        document.documentTitle,
      ].join(' ').toLowerCase();
      return matchesFilter && (!query || haystack.includes(query));
    });

    return [...filtered].sort((left, right) => this.compareDocuments(left, right));
  });

  selectedDocument = computed(() => {
    const selectedId = this.selectedDocumentId();
    if (!selectedId) return null;
    return this.filteredDocuments().find(document => document.documentId === selectedId) ?? null;
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
      if (!applicationId) return;
      const document = this.documents().find(item => item.applicationId === applicationId);
      if (document) {
        this.selectedDocumentId.set(document.documentId);
      }
    });
  }

  refresh(): void {
    if (!this.enabled()) {
      this.documents.set([]);
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.applicationTracker.listApplications().subscribe({
      next: applications => this.loadDocuments(applications),
      error: err => {
        this.loading.set(false);
        this.error.set('Could not load documents. Please try again.');
        console.error('Documents workspace load failed:', err);
      },
    });
  }

  selectFilter(filter: DocumentFilter): void {
    this.selectedFilter.set(filter);
  }

  setSearchTerm(value: string): void {
    this.searchTerm.set(value);
  }

  toggleDocument(document: ApplicationDocument): void {
    this.selectedDocumentId.update(selectedId => selectedId === document.documentId ? null : document.documentId);
  }

  collapseDocument(): void {
    this.selectedDocumentId.set(null);
  }

  @HostListener('document:keydown.escape')
  collapseDocumentOnEscape(): void {
    if (this.selectedDocumentId()) {
      this.collapseDocument();
    }
  }

  isExpanded(document: ApplicationDocument): boolean {
    return this.selectedDocumentId() === document.documentId;
  }

  documentFocusId(document: ApplicationDocument): string {
    return `document-${this.slug(document.documentId || `${document.documentTitle}-${document.companyName ?? 'company'}`)}`;
  }

  documentFocusGroup(document: ApplicationDocument): string {
    return this.documentFocusId(document);
  }

  countFor(filter: DocumentFilter): number {
    return this.documents().filter(document => filter === 'ALL' || document.documentType === filter).length;
  }

  documentTypeLabel(type: DocumentKind): string {
    return type === 'CV' ? 'CV' : 'Cover Letter';
  }

  statusLabel(status: string | undefined | null): string {
    return status || 'UNKNOWN';
  }

  statusClass(status: string | undefined | null): string {
    return `status-${(status ?? 'unknown').toLowerCase().replaceAll('_', '-')}`;
  }

  canReplace(document: ApplicationDocument): boolean {
    return false;
  }

  canDelete(document: ApplicationDocument): boolean {
    return false;
  }

  latestFileType(document: ApplicationDocument): string {
    if (document.downloads?.docx) return 'DOCX';
    if (document.downloads?.pdf) return 'PDF';
    return 'Unknown';
  }

  fileSize(document: ApplicationDocument): string {
    const size = document.fileSize;
    if (!size) return 'Unknown';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
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

  download(file: DownloadFileResponse | undefined): void {
    if (!file) return;
    this.documentGenerationService.download(file).catch(err => {
      this.notify.emit({ message: 'Download failed. Please try again.', type: 'error' });
      console.error('Document download failed:', err);
    });
  }

  onReplacementSelected(document: ApplicationDocument, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.canReplace(document)) return;
    if (!this.documentGenerationService.isDocx(file)) {
      this.notify.emit({ message: 'Please upload a Microsoft Word .docx file.', type: 'error' });
      return;
    }

    this.replacingDocumentId.set(document.documentId);
    this.documentGenerationService.uploadReplacement(
      document.applicationId,
      file,
      document.documentType,
    ).then(() => {
      this.notify.emit({ message: `${this.documentTypeLabel(document.documentType)} replaced successfully. PDF version has been updated.`, type: 'success' });
      this.applicationChanged.emit();
      this.refresh();
    }).catch(err => {
      const message = err instanceof Error ? err.message : 'Replacement upload failed.';
      this.notify.emit({ message, type: 'error' });
      console.error('Document replacement failed:', err);
    }).finally(() => this.replacingDocumentId.set(null));
  }

  deleteDocument(document: ApplicationDocument): void {
    if (!this.canDelete(document) || this.deletingDocumentId()) return;
    if (!window.confirm(`Delete generated documents for ${document.jobTitle || 'this application'}? This is only allowed before the application is applied.`)) return;

    this.deletingDocumentId.set(document.documentId);
    this.documentGenerationService.withdrawGeneratedApplication(document.applicationId).then(() => {
      this.notify.emit({ message: 'Generated documents deleted.', type: 'success' });
      this.documents.update(documents => documents.filter(item => item.applicationId !== document.applicationId));
      if (this.selectedDocumentId() && !this.documents().some(item => item.documentId === this.selectedDocumentId())) {
        this.selectedDocumentId.set(null);
      }
      this.applicationChanged.emit();
    }).catch(err => {
      const message = err instanceof Error ? err.message : 'Documents could not be deleted. They may already be part of the application history.';
      this.notify.emit({ message, type: 'error' });
      console.error('Document delete failed:', err);
    }).finally(() => this.deletingDocumentId.set(null));
  }

  openLinkedApplication(document: ApplicationDocument): void {
    this.openApplication.emit(document.applicationId);
  }

  private loadDocuments(applications: TrackedApplication[]): void {
    const baseDocuments = applications.flatMap(application => this.documentsForApplication(application));
    if (baseDocuments.length === 0) {
      this.documents.set([]);
      this.selectedDocumentId.set(null);
      this.loading.set(false);
      return;
    }

    forkJoin(baseDocuments.map(document => this.hydrateDocument(document))).subscribe({
      next: documents => {
        this.documents.set(documents);
        if (this.selectedDocumentId() && !documents.some(document => document.documentId === this.selectedDocumentId())) {
          this.selectedDocumentId.set(null);
        }
        this.loading.set(false);
      },
      error: err => {
        this.documents.set(baseDocuments);
        this.loading.set(false);
        console.warn('Some document metadata could not be loaded:', err);
      },
    });
  }

  private documentsForApplication(application: TrackedApplication): ApplicationDocument[] {
    const applicationId = application.applicationId ?? application.id ?? '';
    const shared = {
      applicationId,
      canonicalJobId: application.canonicalJobId ?? application.jobId,
      jobTitle: application.jobTitle,
      companyName: application.companyName,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
      status: application.status,
      appliedAt: application.appliedAt,
      interviewAt: application.interviewAt,
      application,
      version: 1,
      metadata: [],
    };

    const documents: ApplicationDocument[] = [];
    if (application.cvDocumentId) {
      documents.push({
        ...shared,
        documentId: application.cvDocumentId,
        documentType: 'CV',
        documentTitle: `CV - ${application.jobTitle || 'Application'}`,
      });
    }
    if (application.coverLetterDocumentId) {
      documents.push({
        ...shared,
        documentId: application.coverLetterDocumentId,
        documentType: 'COVER_LETTER',
        documentTitle: `Cover Letter - ${application.jobTitle || 'Application'}`,
      });
    }
    return documents;
  }

  private hydrateDocument(document: ApplicationDocument) {
    return forkJoin({
      downloads: this.documentGenerationService.latestFiles(document.documentId).pipe(catchError(() => of(undefined))),
      latestMetadata: this.documentGenerationService.latestFileMetadata(document.documentId).pipe(catchError(() => of([]))),
      allMetadata: this.documentGenerationService.allFileMetadata(document.documentId).pipe(catchError(() => of([]))),
    }).pipe(
      catchError(() => of({ downloads: undefined, latestMetadata: [], allMetadata: [] })),
      map(({ downloads, latestMetadata, allMetadata }) => {
        const metadata = allMetadata.length > 0 ? allMetadata : latestMetadata;
        const latestUpdated = metadata
          .map(file => file.updatedAt ?? file.createdAt)
          .filter(Boolean)
          .sort((left, right) => Date.parse(String(right)) - Date.parse(String(left)))[0];
        const fileSize = metadata
          .map(file => file.sizeBytes ?? file.fileSize)
          .find(size => typeof size === 'number' && size > 0);
        return {
          ...document,
          downloads,
          metadata,
          updatedAt: latestUpdated ?? document.updatedAt,
          version: Math.max(1, metadata.length ? Math.ceil(metadata.length / 2) : 1),
          fileSize,
        };
      })
    );
  }

  private compareDocuments(left: ApplicationDocument, right: ApplicationDocument): number {
    switch (this.selectedSort()) {
      case 'OLDEST':
        return this.time(left.createdAt) - this.time(right.createdAt);
      case 'JOB_TITLE':
        return (left.jobTitle || '').localeCompare(right.jobTitle || '');
      case 'COMPANY':
        return (left.companyName || '').localeCompare(right.companyName || '');
      case 'STATUS':
        return (left.status || '').localeCompare(right.status || '');
      case 'NEWEST':
      default:
        return this.time(right.createdAt) - this.time(left.createdAt);
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
