import { ChangeDetectionStrategy, Component, computed, input, output, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { DocumentUploadRequest, JobCardComponent } from '../job-card/job-card.component';
import { JobService } from '../../services/job.service';
import { DocumentGenerationService } from '../../services/document-generation.service';
import { Job } from '../../models/job-search.model';
import { ApplicationRecordResponse, UpdateApplicationStatusRequest } from '../../api/job-finder';
import {
  DownloadFileResponse,
  GenerationDownloadsResponse,
} from '../../api/document-generation-gateway';
import {logMalformedProviderResult} from '../../../shared/provider-content-policy';

type StatusUpdateTarget = UpdateApplicationStatusRequest['status'];
type SortOption = 'MOST_RELEVANT' | 'CLOSEST' | 'HIGHEST_SALARY' | 'NEWEST_POSTED' | 'OLDEST_POSTED' | 'COMPANY_AZ' | 'JOB_TITLE_AZ';

@Component({
  selector: 'app-job-results',
  imports: [CommonModule, MatIconModule, JobCardComponent],
  host: {
    'data-demo-focus': 'app-job-results',
    'data-demo-focus-id': 'job-results-workspace'
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './job-results.component.html',
  styleUrl: './job-results.component.css'
})
export class JobResultsComponent implements OnInit {
  private jobService = inject(JobService);
  private documentGenerationService = inject(DocumentGenerationService);

  // Inputs from the parent App component (profile signals)
  skills = input<string>('');
  experience = input<string>('');
  aspirations = input<string>('');
  workPrefs = input<string>('');
  authToken = input<string>('');
  userId = input<string>('');

  // Output to notify parent to show a toast
  notify = output<{ message: string; type: 'success' | 'info' | 'error' }>();
  applicationChanged = output<void>();

  // Reactive state
  jobs = signal<Job[]>([]);
  roleResults = signal<{ targetRole: string; jobs: Job[] }[]>([]);
  selectedTargetRole = signal<string>('');
  selectedPublisher = signal<string>('All Job Sites');
  selectedSort = signal<SortOption>('MOST_RELEVANT');
  filtersOpen = signal(false);
  providerWarnings = signal<string[]>([]);
  currentPage = signal(1);
  totalResults = signal(0);
  loading = signal(false);
  error = signal<string | null>(null);
  generatingJobIds = signal<Set<string>>(new Set());
  generationMessages = signal<Record<string, string | undefined>>({});
  generationErrors = signal<Record<string, string | undefined>>({});
  generationDownloads = signal<Record<string, GenerationDownloadsResponse | undefined>>({});
  generatedDocumentIds = signal<Record<string, { cvDocumentId?: string; coverLetterDocumentId?: string } | undefined>>({});
  uploadingDocuments = signal<Record<string, 'CV' | 'COVER_LETTER' | undefined>>({});
  updatingApplicationStatuses = signal<Record<string, StatusUpdateTarget | undefined>>({});
  readonly jobsPerPage = 10;
  readonly Math = Math;
  readonly futureFilterSections = ['Status', 'Date Posted', 'Salary', 'Location', 'Remote / On-site'];
  readonly sortOptions: { value: SortOption; label: string }[] = [
    { value: 'MOST_RELEVANT', label: 'Most relevant' },
    { value: 'CLOSEST', label: 'Closest to me' },
    { value: 'HIGHEST_SALARY', label: 'Highest salary' },
    { value: 'NEWEST_POSTED', label: 'Newest posted' },
    { value: 'OLDEST_POSTED', label: 'Oldest posted' },
    { value: 'COMPANY_AZ', label: 'Company A-Z' },
    { value: 'JOB_TITLE_AZ', label: 'Job title A-Z' },
  ];
  readonly futureSortOptions = ['Best match', 'Recently updated', 'Remote first', 'Most sources', 'Application status'];

  activeRoleResults = computed(() =>
    this.roleResults().find(group => group.targetRole === this.selectedTargetRole()) ?? this.roleResults()[0]
  );

  activeJobs = computed(() => this.activeRoleResults()?.jobs ?? []);

  publisherOptions = computed(() => {
    const counts = new Map<string, number>();
    for (const job of this.activeJobs()) {
      for (const publisher of this.publishersForJob(job)) {
        counts.set(publisher, (counts.get(publisher) ?? 0) + 1);
      }
    }
    const preferredOrder = ['Reed.co.uk', 'Adzuna', 'Indeed', 'LinkedIn', 'Employer Sites', 'Other'];
    return [
      { label: 'All Job Sites', count: this.activeJobs().length },
      ...Array.from(counts.entries())
        .sort((a, b) => preferredOrder.indexOf(a[0]) - preferredOrder.indexOf(b[0]))
        .map(([label, count]) => ({ label, count }))
    ];
  });

  sourceFilterActive = computed(() => this.selectedPublisher() !== 'All Job Sites');

  filteredJobs = computed(() => {
    const selected = this.selectedPublisher();
    if (selected === 'All Job Sites') {
      return this.activeJobs();
    }
    return this.activeJobs().filter(job => this.publishersForJob(job).includes(selected));
  });

  sortedJobs = computed(() => {
    const jobs = this.filteredJobs();
    const index = new Map(jobs.map((job, position) => [job.id ?? String(position), position]));
    return [...jobs].sort((left, right) => {
      const comparison = this.compareJobs(left, right);
      if (comparison !== 0) {
        return comparison;
      }
      return (index.get(left.id ?? '') ?? 0) - (index.get(right.id ?? '') ?? 0);
    });
  });

  totalPages = computed(() => Math.max(1, Math.ceil(this.sortedJobs().length / this.jobsPerPage)));

  paginatedJobs = computed(() => {
    const start = (this.currentPage() - 1) * this.jobsPerPage;
    return this.sortedJobs().slice(start, start + this.jobsPerPage);
  });

  ngOnInit(): void {
    // Auto-trigger search when the component initialises (profile is already loaded)
    this.search();
  }

  trackByJobId(index: number, job: Job): string {
    return job.id ?? String(index);
  }

  private validateJob(job: Job): Job | null {
    const requiredFields = ['id', 'title', 'company', 'location', 'description', 'url'];
    const missingFields = requiredFields.filter(field => {
      if (field === 'salary') {
        return !job.salary || typeof job.salary.min !== 'number' || typeof job.salary.max !== 'number';
      }
      const value = job[field as keyof Job];
      return value == null || value === '';
    });

    if (missingFields.length > 0) {
      logMalformedProviderResult(missingFields.length);
      return null;
    }

    return job;
  }

  search(): void {
    const token = this.authToken();
    if (!token) {
      this.error.set('Authentication token is missing. Please log in again.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    this.jobService.searchJobs(
      this.skills(),
      this.experience(),
      this.aspirations(),
      this.workPrefs(),
      token,
      this.userId()
    ).subscribe({
      next: (response) => {
        const roleGroups = response.resultsByTargetRole?.length
          ? response.resultsByTargetRole
          : [{ targetRole: 'All matches', jobs: response.jobs ?? [] }];
        const validGroups: { targetRole: string; jobs: Job[] }[] = [];
        const validJobs: Job[] = [];
        const skippedCount = { value: 0 };

        for (const group of roleGroups) {
          const groupJobs: Job[] = [];
          for (const job of group.jobs ?? []) {
            const validated = this.validateJob(job);
            if (validated) {
              groupJobs.push(validated);
              validJobs.push(validated);
            } else {
              skippedCount.value++;
            }
          }
          validGroups.push({
            targetRole: group.targetRole || 'Untitled role',
            jobs: groupJobs
          });
        }

        if (skippedCount.value > 0) {
          console.warn(`[JobResults] Filtered out ${skippedCount.value} malformed job(s)`);
        }

        this.jobs.set(validJobs);
        this.roleResults.set(validGroups);
        this.selectedTargetRole.set(validGroups[0]?.targetRole ?? '');
        this.selectedPublisher.set('All Job Sites');
        this.selectedSort.set('MOST_RELEVANT');
        this.filtersOpen.set(false);
        this.currentPage.set(1);
        this.totalResults.set(validJobs.length);
        this.providerWarnings.set((response.providerResults ?? [])
          .filter(result => result.status === 'UNAVAILABLE')
          .map(result => `${result.provider} was temporarily unavailable. Results from other job sites are still shown.`));
        this.reconcileGeneratedState(validJobs);
        this.rehydrateGeneratedDownloads(validJobs);
        this.loading.set(false);
        this.notify.emit({
          message: `Found ${validJobs.length} matching job${validJobs.length === 1 ? '' : 's'}.`,
          type: 'success'
        });
      },
      error: (err) => {
        this.loading.set(false);
        const status = err.status;

        if (status === 503) {
          this.error.set('Job search service is temporarily unavailable. Please try again later.');
          this.notify.emit({
            message: 'Job search service is temporarily unavailable. Please try again later.',
            type: 'error'
          });
        } else if (status === 400) {
          this.error.set('Invalid search parameters. Please update your profile and try again.');
          this.notify.emit({
            message: 'Invalid search parameters. Please update your profile and try again.',
            type: 'error'
          });
        } else if (status === 401 || status === 403) {
          this.error.set('Session expired. Please log in again.');
          this.notify.emit({
            message: 'Session expired. Please log in again.',
            type: 'error'
          });
        } else {
          this.error.set('An unexpected error occurred while searching for jobs.');
          this.notify.emit({
            message: 'An unexpected error occurred while searching for jobs.',
            type: 'error'
          });
        }

        console.error('[JobResults] Job search failed');
      }
    });
  }

  refresh(): void {
    this.search();
  }

  selectTargetRole(targetRole: string): void {
    if (targetRole === this.selectedTargetRole()) return;
    this.selectedTargetRole.set(targetRole);
    this.selectedPublisher.set('All Job Sites');
    this.currentPage.set(1);
  }

  selectPublisher(publisher: string): void {
    if (publisher === this.selectedPublisher()) return;
    this.selectedPublisher.set(publisher);
    this.currentPage.set(1);
  }

  selectSort(value: string): void {
    this.selectedSort.set(value as SortOption);
    this.currentPage.set(1);
  }

  toggleFilters(): void {
    this.filtersOpen.update(open => !open);
  }

  previousPage(): void {
    this.currentPage.update(page => Math.max(1, page - 1));
  }

  nextPage(): void {
    this.currentPage.update(page => Math.min(this.totalPages(), page + 1));
  }

  private compareJobs(left: Job, right: Job): number {
    switch (this.selectedSort()) {
      case 'CLOSEST':
        return this.compareNullableNumber(left.distanceMiles, right.distanceMiles, 'asc');
      case 'HIGHEST_SALARY':
        return this.compareNullableNumber(left.salary?.normalisedAnnualMidpoint, right.salary?.normalisedAnnualMidpoint, 'desc');
      case 'NEWEST_POSTED':
        return this.compareNullableNumber(this.postedTime(left), this.postedTime(right), 'desc');
      case 'OLDEST_POSTED':
        return this.compareNullableNumber(this.postedTime(left), this.postedTime(right), 'asc');
      case 'COMPANY_AZ':
        return this.compareNullableText(left.companyName ?? left.company, right.companyName ?? right.company);
      case 'JOB_TITLE_AZ':
        return this.compareNullableText(left.jobTitle ?? left.title, right.jobTitle ?? right.title);
      case 'MOST_RELEVANT':
      default:
        return 0;
    }
  }

  private compareNullableNumber(left: number | undefined | null, right: number | undefined | null, direction: 'asc' | 'desc'): number {
    const leftMissing = left == null || Number.isNaN(left);
    const rightMissing = right == null || Number.isNaN(right);
    if (leftMissing && rightMissing) return 0;
    if (leftMissing) return 1;
    if (rightMissing) return -1;
    return direction === 'asc' ? left - right : right - left;
  }

  private compareNullableText(left: string | undefined | null, right: string | undefined | null): number {
    const leftValue = left?.trim();
    const rightValue = right?.trim();
    if (!leftValue && !rightValue) return 0;
    if (!leftValue) return 1;
    if (!rightValue) return -1;
    return leftValue.localeCompare(rightValue);
  }

  private postedTime(job: Job): number | null {
    const posted = job.postedAt ?? job.postedDate;
    if (!posted) return null;
    const time = Date.parse(posted);
    return Number.isNaN(time) ? null : time;
  }

  generateDocuments(job: Job): void {
    if (!job.id || this.generatingJobIds().has(job.id)) return;
    const jobId = job.id;
    this.generatingJobIds.update(ids => new Set(ids).add(jobId));
    this.generationMessages.update(messages => ({ ...messages, [jobId]: 'Generating CV & Cover Letter...' }));
    this.generationErrors.update(errors => ({ ...errors, [jobId]: undefined }));

    this.documentGenerationService.generate(job, this.authToken(), this.userId()).subscribe({
      next: (response) => {
        this.generationDownloads.update(downloads => ({ ...downloads, [jobId]: response.downloads }));
        this.generatedDocumentIds.update(documentIds => ({
          ...documentIds,
          [jobId]: {
            cvDocumentId: response.cvDocumentId,
            coverLetterDocumentId: response.coverLetterDocumentId,
          }
        }));
        this.updateJobLocally(jobId, {
          applicationId: response.applicationId ?? job.applicationId,
          applicationStatus: 'DOCUMENTS_GENERATED',
          cvDocumentId: response.cvDocumentId ?? job.cvDocumentId,
          coverLetterDocumentId: response.coverLetterDocumentId ?? job.coverLetterDocumentId,
        });
        this.finishGeneration(jobId, 'CV and cover letter generated successfully.');
        this.notify.emit({ message: 'CV and cover letter generated successfully.', type: 'success' });
        this.applicationChanged.emit();
      },
      error: () => {
        this.finishGeneration(jobId, undefined);
        this.generationErrors.update(errors => ({ ...errors, [jobId]: 'Generation failed. Please try again.' }));
        this.notify.emit({ message: 'Generation failed. Please try again.', type: 'error' });
        console.error('[JobResults] Document generation failed');
      }
    });
  }

  updateApplicationStatus(job: Job, status: StatusUpdateTarget): void {
    if (!job.id || !job.applicationId || this.updatingApplicationStatuses()[job.id]) {
      if (!job.applicationId) {
        this.notify.emit({
          message: 'Application record is missing. Generate documents before updating status.',
          type: 'error',
        });
      }
      return;
    }

    const jobId = job.id;
    this.updatingApplicationStatuses.update(updating => ({ ...updating, [jobId]: status }));
    this.jobService.updateApplicationStatus(job.applicationId, status, this.authToken(), this.userId()).subscribe({
      next: (record) => {
        this.applyApplicationRecord(jobId, record);
        const updatedStatus = record.status ?? status;
        this.notify.emit({
          message: updatedStatus === 'APPLIED'
            ? 'Application marked as applied. Documents are now locked.'
            : `Application status updated to ${this.friendlyStatus(updatedStatus)}.`,
          type: 'success',
        });
        this.applicationChanged.emit();
      },
      error: () => {
        this.updatingApplicationStatuses.update(updating => ({ ...updating, [jobId]: undefined }));
        this.notify.emit({
          message: 'Could not update application status. Please try again.',
          type: 'error',
        });
        console.error('[JobResults] Application status update failed');
      },
      complete: () => {
        this.updatingApplicationStatuses.update(updating => ({ ...updating, [jobId]: undefined }));
      },
    });
  }

  withdrawGeneratedApplication(job: Job): void {
    if (!job.id || !job.applicationId || this.updatingApplicationStatuses()[job.id]) {
      if (!job.applicationId) {
        this.notify.emit({
          message: 'Application record is missing. Generate documents before withdrawing.',
          type: 'error',
        });
      }
      return;
    }

    const jobId = job.id;
    this.updatingApplicationStatuses.update(updating => ({ ...updating, [jobId]: 'WITHDRAWN' }));
    this.jobService.withdrawGeneratedApplication(job.applicationId, this.authToken(), this.userId()).subscribe({
      next: () => {
        this.updateJobLocally(jobId, {
          applicationId: undefined,
          applicationStatus: 'NEW',
          cvDocumentId: undefined,
          coverLetterDocumentId: undefined,
          appliedAt: undefined,
          applicationUpdatedAt: undefined,
        });
        this.generationDownloads.update(downloads => ({ ...downloads, [jobId]: undefined }));
        this.generatedDocumentIds.update(documentIds => ({ ...documentIds, [jobId]: undefined }));
        this.generationMessages.update(messages => ({ ...messages, [jobId]: undefined }));
        this.generationErrors.update(errors => ({ ...errors, [jobId]: undefined }));
        this.notify.emit({
          message: 'Generated application withdrawn and reset to new.',
          type: 'success',
        });
        this.applicationChanged.emit();
      },
      error: () => {
        this.updatingApplicationStatuses.update(updating => ({ ...updating, [jobId]: undefined }));
        this.notify.emit({
          message: 'Could not withdraw generated application. Please try again.',
          type: 'error',
        });
        console.error('[JobResults] Generated application withdrawal failed');
      },
      complete: () => {
        this.updatingApplicationStatuses.update(updating => ({ ...updating, [jobId]: undefined }));
      },
    });
  }

  uploadReplacement(job: Job, request: DocumentUploadRequest): void {
    if (!job.id || this.uploadingDocuments()[job.id]) return;
    const jobId = job.id;

    this.uploadingDocuments.update(uploading => ({ ...uploading, [jobId]: request.documentKind }));
    this.documentGenerationService.uploadReplacement(
      request.applicationId,
      request.file,
      request.documentKind,
      this.authToken(),
      this.userId()
    ).then((response) => {
      this.generationDownloads.update(downloads => {
        const existing = downloads[jobId] ?? {};
        const next: GenerationDownloadsResponse = {
          ...existing,
          cv: request.documentKind === 'CV' ? response.latestFiles : existing.cv,
          coverLetter: request.documentKind === 'COVER_LETTER' ? response.latestFiles : existing.coverLetter,
        };
        return { ...downloads, [jobId]: next };
      });
      this.generatedDocumentIds.update(documentIds => ({
        ...documentIds,
        [jobId]: {
          cvDocumentId: response.cvDocumentId ?? documentIds[jobId]?.cvDocumentId ?? job.cvDocumentId,
          coverLetterDocumentId: response.coverLetterDocumentId ?? documentIds[jobId]?.coverLetterDocumentId ?? job.coverLetterDocumentId,
        },
      }));
      this.updateJobLocally(jobId, {
        cvDocumentId: response.cvDocumentId ?? job.cvDocumentId,
        coverLetterDocumentId: response.coverLetterDocumentId ?? job.coverLetterDocumentId,
      });
      this.notify.emit({
        message: response.message || `${request.documentKind === 'CV' ? 'CV' : 'Cover letter'} replaced successfully. PDF version has been updated.`,
        type: 'success'
      });
      this.applicationChanged.emit();
    }).catch((err) => {
      const message = err instanceof Error
        ? err.message
        : 'Upload failed. Please choose a DOCX file under 25MB.';
      this.notify.emit({ message, type: 'error' });
      console.error('[JobResults] Document upload failed');
    }).finally(() => {
      this.uploadingDocuments.update(uploading => ({ ...uploading, [jobId]: undefined }));
    });
  }

  downloadFile(file: DownloadFileResponse): void {
    this.documentGenerationService.download(file, this.authToken()).catch(() => {
      this.notify.emit({ message: 'Download failed. Please try again.', type: 'error' });
      console.error('[JobResults] Document download failed');
    });
  }

  dismissGenerationError(jobId: string): void {
    this.generationErrors.update(errors => ({ ...errors, [jobId]: undefined }));
  }

  private finishGeneration(jobId: string, message: string | undefined): void {
    this.generatingJobIds.update(ids => {
      const next = new Set(ids);
      next.delete(jobId);
      return next;
    });
    this.generationMessages.update(messages => ({ ...messages, [jobId]: message }));
  }

  private applyApplicationRecord(jobId: string, record: ApplicationRecordResponse): void {
    this.updateJobLocally(jobId, {
      applicationId: record.id,
      applicationStatus: record.status,
      cvDocumentId: record.cvDocumentId,
      coverLetterDocumentId: record.coverLetterDocumentId,
      appliedAt: record.appliedAt,
      applicationUpdatedAt: record.updatedAt,
    });
    this.generatedDocumentIds.update(documentIds => ({
      ...documentIds,
      [jobId]: {
        cvDocumentId: record.cvDocumentId,
        coverLetterDocumentId: record.coverLetterDocumentId,
      },
    }));
  }

  private updateJobLocally(jobId: string, patch: Partial<Job>): void {
    const applyPatch = (job: Job): Job => job.id === jobId ? { ...job, ...patch } : job;
    this.jobs.update(jobs => jobs.map(applyPatch));
    this.roleResults.update(groups => groups.map(group => ({
      ...group,
      jobs: group.jobs.map(applyPatch),
    })));
  }

  private friendlyStatus(status: string): string {
    return status.toLowerCase().replaceAll('_', ' ');
  }

  private reconcileGeneratedState(jobs: Job[]): void {
    const visibleGeneratedJobIds = new Set(
      jobs
        .filter(job => job.id && this.hasPersistedGeneratedDocuments(job))
        .map(job => job.id as string)
    );

    this.generationDownloads.update(downloads => this.keepKeys(downloads, visibleGeneratedJobIds));
    this.generatedDocumentIds.update(documentIds => this.keepKeys(documentIds, visibleGeneratedJobIds));
    this.generationMessages.update(messages => this.keepKeys(messages, visibleGeneratedJobIds));
    this.generationErrors.update(errors => this.keepKeys(errors, new Set(jobs.map(job => job.id).filter(Boolean) as string[])));
  }

  private keepKeys<T>(record: Record<string, T | undefined>, keysToKeep: Set<string>): Record<string, T | undefined> {
    return Object.fromEntries(
      Object.entries(record).filter(([key]) => keysToKeep.has(key))
    ) as Record<string, T | undefined>;
  }

  private hasPersistedGeneratedDocuments(job: Job): boolean {
    const status = job.applicationStatus;
    return Boolean(
      job.applicationId
      && job.cvDocumentId
      && job.coverLetterDocumentId
      && status
      && status !== 'NEW'
      && status !== 'WITHDRAWN'
    );
  }

  private currentJob(jobId: string): Job | undefined {
    return this.jobs().find(job => job.id === jobId);
  }

  private rehydrateGeneratedDownloads(jobs: Job[]): void {
    for (const job of jobs) {
      if (!job.id || !this.hasPersistedGeneratedDocuments(job)) continue;
      const jobId = job.id;
      const cvDocumentId = job.cvDocumentId as string;
      const coverLetterDocumentId = job.coverLetterDocumentId as string;
      this.generatedDocumentIds.update(documentIds => ({
        ...documentIds,
        [jobId]: {
          cvDocumentId,
          coverLetterDocumentId,
        },
      }));

      this.documentGenerationService.latestFiles(cvDocumentId).subscribe({
        next: (cv) => {
          const current = this.currentJob(jobId);
          if (!current || !this.hasPersistedGeneratedDocuments(current) || current.cvDocumentId !== cvDocumentId) return;
          this.generationDownloads.update(downloads => ({
            ...downloads,
            [jobId]: { ...(downloads[jobId] ?? {}), cv },
          }));
        },
        error: () => console.warn('[JobResults] Could not restore CV downloads'),
      });

      this.documentGenerationService.latestFiles(coverLetterDocumentId).subscribe({
        next: (coverLetter) => {
          const current = this.currentJob(jobId);
          if (!current || !this.hasPersistedGeneratedDocuments(current) || current.coverLetterDocumentId !== coverLetterDocumentId) return;
          this.generationDownloads.update(downloads => ({
            ...downloads,
            [jobId]: { ...(downloads[jobId] ?? {}), coverLetter },
          }));
        },
        error: () => console.warn('[JobResults] Could not restore cover letter downloads'),
      });
    }
  }

  publishersForJob(job: Job): string[] {
    const publishers = new Set<string>();
    for (const source of job.sources ?? []) {
      publishers.add(this.sourceFilterLabel(source.publisher, source.integrationProvider ?? source.provider));
    }
    if (publishers.size === 0) {
      publishers.add(this.sourceFilterLabel(this.publisherFromUrl(job.url), job.primarySource ?? job.provider));
    }
    return Array.from(publishers);
  }

  private sourceFilterLabel(publisher: string | undefined | null, provider: string | undefined | null): string {
    const value = (publisher ?? '').trim().toLowerCase();
    const providerValue = (provider ?? '').trim().toUpperCase();
    if (value.includes('reed') || providerValue === 'REED') return 'Reed.co.uk';
    if (value.includes('adzuna') || providerValue === 'ADZUNA') return 'Adzuna';
    if (value.includes('indeed')) return 'Indeed';
    if (value.includes('linkedin')) return 'LinkedIn';
    if (value.includes('employer site')) return 'Employer Sites';
    return 'Other';
  }

  private publisherFromUrl(url: string | undefined): string | null {
    if (!url) return null;
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }

}
