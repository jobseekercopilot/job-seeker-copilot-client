import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, OnInit, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import {
  ApplicationEvent,
  ApplicationFilter,
  ApplicationTrackerService,
  TrackedApplication,
} from '../../services/application-tracker.service';
import { DocumentGenerationService, DocumentKind } from '../../services/document-generation.service';
import {
  DocumentDownloadsResponse,
  DownloadFileResponse,
  GenerationDownloadsResponse,
} from '../../api/document-generation-gateway';

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

  userId = input<string>('');
  authToken = input<string>('');
  selectedApplicationId = input<string | null>(null);
  notify = output<{ message: string; type: 'success' | 'info' | 'error' }>();
  applicationChanged = output<void>();

  applications = signal<TrackedApplication[]>([]);
  selectedFilter = signal<ApplicationFilter>('ALL');
  loading = signal(false);
  error = signal<string | null>(null);
  downloads = signal<Record<string, GenerationDownloadsResponse | undefined>>({});
  uploadingDocuments = signal<Record<string, DocumentKind | undefined>>({});
  updatingStatuses = signal<Record<string, StatusUpdateTarget | undefined>>({});

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
    this.loading.set(true);
    this.error.set(null);
    this.applicationTracker.listApplications().subscribe({
      next: applications => {
        this.applications.set(applications);
        this.loading.set(false);
        this.loadDownloads(applications);
      },
      error: err => {
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
    return false;
  }

  downloadGroup(application: TrackedApplication, kind: DocumentKind): DocumentDownloadsResponse | undefined {
    const applicationId = this.applicationId(application);
    return kind === 'CV' ? this.downloads()[applicationId]?.cv : this.downloads()[applicationId]?.coverLetter;
  }

  downloadFile(file: DownloadFileResponse | undefined): void {
    if (!file) return;
    this.documentGenerationService.download(file).catch(err => {
      this.notify.emit({ message: 'Download failed. Please try again.', type: 'error' });
      console.error('Application document download failed:', err);
    });
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
      const existing = this.downloads()[applicationId] ?? {};
      this.downloads.update(downloads => ({
        ...downloads,
        [applicationId]: {
          ...existing,
          cv: kind === 'CV' ? response.latestFiles : existing.cv,
          coverLetter: kind === 'COVER_LETTER' ? response.latestFiles : existing.coverLetter,
        },
      }));
      this.applications.update(applications => applications.map(item =>
        this.applicationId(item) === applicationId
          ? {
              ...item,
              cvDocumentId: response.cvDocumentId ?? item.cvDocumentId,
              coverLetterDocumentId: response.coverLetterDocumentId ?? item.coverLetterDocumentId,
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
    this.applicationTracker.updateStatus(applicationId, status).subscribe({
      next: record => {
        this.upsert(record);
        this.notify.emit({ message: `Application updated to ${this.statusLabel(record.status)}.`, type: 'success' });
        this.applicationChanged.emit();
      },
      error: err => {
        this.notify.emit({ message: 'Could not update application status. Please try again.', type: 'error' });
        console.error('Application workspace status update failed:', err);
      },
      complete: () => this.updatingStatuses.update(updating => ({ ...updating, [applicationId]: undefined })),
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

  private withdraw(application: TrackedApplication): void {
    const applicationId = this.applicationId(application);
    this.updatingStatuses.update(updating => ({ ...updating, [applicationId]: 'WITHDRAWN' }));
    this.applicationTracker.withdrawGeneratedApplication(applicationId).subscribe({
      next: () => {
        this.applications.update(applications => applications.filter(item => this.applicationId(item) !== applicationId));
        this.notify.emit({ message: 'Generated application withdrawn.', type: 'success' });
        this.applicationChanged.emit();
      },
      error: err => {
        this.notify.emit({ message: 'Could not withdraw this application. Please try again.', type: 'error' });
        console.error('Application workspace withdraw failed:', err);
      },
      complete: () => this.updatingStatuses.update(updating => ({ ...updating, [applicationId]: undefined })),
    });
  }

  private upsert(record: TrackedApplication): void {
    const recordId = this.applicationId(record);
    this.applications.update(applications => applications.map(application =>
      this.applicationId(application) === recordId ? { ...application, ...record } : application
    ));
  }

  private loadDownloads(applications: TrackedApplication[]): void {
    for (const application of applications) {
      const applicationId = this.applicationId(application);
      if (!applicationId) continue;
      if (application.cvDocumentId) {
        this.documentGenerationService.latestFiles(application.cvDocumentId).subscribe({
          next: cv => this.downloads.update(downloads => ({
            ...downloads,
            [applicationId]: { ...(downloads[applicationId] ?? {}), cv },
          })),
          error: err => console.warn('Could not load CV files for application:', err),
        });
      }
      if (application.coverLetterDocumentId) {
        this.documentGenerationService.latestFiles(application.coverLetterDocumentId).subscribe({
          next: coverLetter => this.downloads.update(downloads => ({
            ...downloads,
            [applicationId]: { ...(downloads[applicationId] ?? {}), coverLetter },
          })),
          error: err => console.warn('Could not load cover letter files for application:', err),
        });
      }
    }
  }

  private matchesFilter(application: TrackedApplication, filter: ApplicationFilter): boolean {
    switch (filter) {
      case 'ALL':
        return true;
      case 'NEEDS_ACTION':
        return application.status === 'DOCUMENTS_GENERATED';
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
