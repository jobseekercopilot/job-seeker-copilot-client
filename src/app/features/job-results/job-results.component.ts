import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnDestroy,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { finalize, Observable, Subscription } from 'rxjs';
import { DocumentUploadRequest, JobCardComponent } from '../job-card/job-card.component';
import { JobService } from '../../services/job.service';
import {
  ApplicationDocumentUploadProgress,
  ApplicationDocumentUploadRequest,
  DocumentGenerationError,
  DocumentGenerationResponse,
  DocumentGenerationService,
  GenerationDownloadsResponse,
  PendingDocumentGeneration,
} from '../../services/document-generation.service';
import {
  Job,
  JobSearchFreshness,
  JobSearchQualitySummary,
  JobSearchResponse,
  ProviderSearchResult,
} from '../../models/job-search.model';
import {
  ApplicationRecordResponse,
  JobAdvertiserTypeEnum,
  JobDescriptionCompletenessEnum,
} from '../../api/job-finder';
import {
  ApplicationDocumentUploadOperationResponse,
  DownloadFileResponse,
  DocumentEvidenceSelectionSectionOrderEnum,
} from '../../api/document-generation-gateway';
import {
  EvidenceEntry,
  EvidenceEntryCategoryEnum,
  EvidenceEntryLifecycleEnum,
  EvidenceEntryVisibilityEnum,
  EvidenceLibraryService,
  EvidenceRevision,
  EvidenceRevisionConfirmationStateEnum,
} from '../../api';
import {
  approvedNhsJobsAdvertUrl,
  logMalformedProviderResult,
  providerPlainText,
} from '../../../shared/provider-content-policy';
import {
  ApplicationTrackerService,
} from '../../services/application-tracker.service';
import type {JobSearchProviderMode} from '../../services/runtime-configuration.service';

type StatusUpdateTarget =
  | 'DOCUMENTS_GENERATED'
  | 'APPLIED'
  | 'INTERVIEW'
  | 'UNSUCCESSFUL'
  | 'OFFER'
  | 'ACCEPTED'
  | 'REJECTED_BY_USER'
  | 'WITHDRAWN';
type SortOption = 'MOST_RELEVANT' | 'CLOSEST' | 'HIGHEST_SALARY' | 'NEWEST_POSTED' | 'OLDEST_POSTED' | 'COMPANY_AZ' | 'JOB_TITLE_AZ';
type EvidencePurpose = 'CV' | 'COVER_LETTER';
type DocumentChoice = 'GENERATE' | 'UPLOAD' | 'OMIT';
type DocumentEntryPoint = 'ADD' | 'GENERATE';
type EvidenceSection = DocumentEvidenceSelectionSectionOrderEnum;
type GenerationAdvertiserType = `${JobAdvertiserTypeEnum}`;
type GenerationJob = Job;

interface RolePageCache {
  jobs: Job[];
  providerStatuses: string[];
  providerWarnings: string[];
  searchStatus: string | null;
  matchingStatus: string | null;
  freshness: JobSearchFreshness | null;
  qualitySummary: JobSearchQualitySummary | null;
  providerResults: ProviderSearchResult[];
}

interface RoleSearchState {
  key: string;
  targetRole: string;
  pages: Record<number, RolePageCache>;
  currentPage: number;
  pageSize: number;
  totalResults: number;
  totalPages: number;
  hasMore: boolean;
  providerStatuses: string[];
  providerWarnings: string[];
  searchStatus: string | null;
  matchingStatus: string | null;
  freshness: JobSearchFreshness | null;
  qualitySummary: JobSearchQualitySummary | null;
  providerResults: ProviderSearchResult[];
  loading: boolean;
  error: string | null;
  searched: boolean;
  requestSequence: number;
  sort: SortOption;
}

interface EvidenceSelectionDraft {
  cvEvidenceIds: string[];
  coverLetterEvidenceIds: string[];
  cvSectionOrder: EvidenceSection[];
  coverLetterSectionOrder: EvidenceSection[];
}

interface EvidenceMatch {
  score: number;
  label: string;
  explanation: string;
}

interface EvidenceSectionPreview {
  section: EvidenceSection;
  headings: string[];
}

interface PendingApplicationUpload {
  request: ApplicationDocumentUploadRequest;
}

interface ApplicationUploadViewState {
  phase: ApplicationDocumentUploadProgress['phase'];
  fileName: string;
  loadedBytes?: number;
  totalBytes?: number;
  percent?: number;
  message?: string;
  canRetry?: boolean;
}

const MATCH_STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'among', 'and', 'any', 'are',
  'because', 'been', 'before', 'being', 'between', 'both', 'build', 'but',
  'can', 'company', 'could', 'did', 'does', 'doing', 'each', 'for', 'from',
  'further', 'had', 'has', 'have', 'having', 'here', 'how', 'into', 'its',
  'more', 'most', 'our', 'out', 'over', 'own', 'role', 'same', 'should',
  'such', 'team', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'under', 'use', 'used', 'using', 'very',
  'was', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'will',
  'with', 'work', 'would', 'you', 'your',
]);

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
export class JobResultsComponent implements OnInit, OnDestroy {
  private jobService = inject(JobService);
  private documentGenerationService = inject(DocumentGenerationService);
  private applicationTracker = inject(ApplicationTrackerService);
  private evidenceLibrary = inject(EvidenceLibraryService);
  private searchRequestSequence = 0;
  private evidenceRequestSequence = 0;
  private jobDetailsRequestSequence = 0;
  private searchContextFingerprint = '';
  private readonly activeGenerationIds = new Set<string>();
  private readonly resumedGenerationIds = new Set<string>();
  private readonly generationSubscriptions = new Map<string, Subscription>();
  private readonly cancellationSubscriptions = new Map<string, Subscription>();
  private readonly applicationUploadSubscriptions = new Map<string, Subscription>();
  private readonly pendingApplicationUploads = new Map<string, Map<EvidencePurpose, PendingApplicationUpload>>();
  private readonly generationOutputsByJob = new Map<string, EvidencePurpose[]>();
  private readonly localApplicationMutationSequence = new Map<string, number>();
  private readonly persistedApplicationsByJobId = new Map<string, ApplicationRecordResponse>();
  private destroyed = false;

  // Inputs from the parent App component (profile signals)
  skills = input<string>('');
  experience = input<string>('');
  aspirations = input<string>('');
  workPrefs = input<string>('');
  authToken = input<string>('');
  userId = input<string>('');
  applicationToolsAvailable = input(false);
  applicationTrackingAvailable = input(false);
  providerMode = input<JobSearchProviderMode>('REQUIRED_VALIDATION');

  // Output to notify parent to show a toast
  notify = output<{ message: string; type: 'success' | 'info' | 'error' }>();
  applicationChanged = output<void>();

  // Reactive state
  readonly roleStates = signal<Record<string, RoleSearchState>>({});
  private readonly roleOrder = signal<string[]>([]);
  selectedTargetRole = signal<string>('');
  readonly activeRoleState = computed(() => {
    const selectedKey = this.roleKey(this.selectedTargetRole());
    return this.roleStates()[selectedKey];
  });
  readonly jobs = computed(() => this.allCachedJobs());
  readonly roleResults = computed(() => this.roleOrder()
    .map(key => this.roleStates()[key])
    .filter((state): state is RoleSearchState => Boolean(state))
    .map(state => ({
      targetRole: state.targetRole,
      jobs: state.pages[state.currentPage]?.jobs ?? [],
      totalResults: state.totalResults,
      loading: state.loading,
      error: state.error,
      searched: state.searched,
      searchStatus: state.searchStatus,
      matchingStatus: state.matchingStatus,
    })));
  selectedPublisher = signal<string>('All Job Sites');
  readonly selectedSort = computed<SortOption>(() =>
    this.activeRoleState()?.sort ?? 'MOST_RELEVANT');
  filtersOpen = signal(false);
  readonly providerWarnings = computed(() =>
    this.activeRoleState()?.providerWarnings ?? []);
  readonly providerStatuses = computed(() =>
    this.activeRoleState()?.providerStatuses ?? []);
  readonly searchStatus = computed(() =>
    this.activeRoleState()?.searchStatus ?? null);
  readonly matchingStatus = computed(() =>
    this.activeRoleState()?.matchingStatus ?? null);
  readonly matchingEvidenceLabel = computed(() => {
    if (this.matchingStatus() !== 'COMPLETE') {
      return 'Results use provider and advert ordering because profile matching was unavailable.';
    }
    const assessments = this.activeJobs()
      .map(job => job.matchAssessment)
      .filter(assessment => Boolean(assessment));
    return assessments.some(assessment => assessment?.candidateProfileUsed)
      ? 'Results are ordered by deterministic profile and advert evidence, not an AI opinion.'
      : 'Results are ordered by deterministic advert and title evidence, not a personal profile match.';
  });
  readonly freshness = computed(() =>
    this.activeRoleState()?.freshness ?? null);
  readonly qualitySummary = computed(() =>
    this.activeRoleState()?.qualitySummary ?? null);
  readonly freshnessLabel = computed(() => {
    const freshness = this.freshness();
    if (!freshness) return 'Freshness not reported';
    switch (freshness.resultSource) {
      case 'PROVIDER_RESPONSE':
        return 'Fresh provider response';
      case 'JOB_SERVICE_CACHE':
        return `Cached provider data${this.cacheAgeLabel(freshness.maximumCacheAgeSeconds)}`;
      case 'MIXED':
        return 'Mixed fresh and cached provider data';
      default:
        return 'Freshness not reported';
    }
  });
  readonly retrievedAtLabel = computed(() => {
    const retrievedAt = this.freshness()?.oldestRetrievedAtUtc;
    if (!retrievedAt) return null;
    const instant = new Date(retrievedAt);
    if (Number.isNaN(instant.getTime())) return null;
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/London',
    }).format(instant);
  });
  readonly filteredResultSummary = computed(() => {
    const quality = this.qualitySummary();
    if (!quality) return null;
    const reasons = [
      this.filteredCountLabel(quality.excludedExpiredCount ?? 0, 'closed or expired listing'),
      this.filteredCountLabel(quality.excludedPaidTrainingCount ?? 0, 'paid training scheme'),
      this.filteredCountLabel(quality.excludedOccupationMismatchCount ?? 0, 'unrelated occupation'),
    ].filter((value): value is string => Boolean(value));
    if (reasons.length === 0) return null;
    return `${reasons.join(', ')} filtered before ranking.`;
  });
  emptyStateMessage = computed(() => {
    if (this.providerMode() !== 'REAL_PROVIDERS') {
      return 'No jobs match your current profile.';
    }
    const statuses = this.providerStatuses().filter(status => status !== 'DISABLED');
    const hasSuccess = statuses.includes('SUCCESS');
    const hasFailure = statuses.some(status => status !== 'SUCCESS');
    if (statuses.includes('CONFIGURATION_ERROR') && !hasSuccess) {
      return 'Provider setup is incomplete. No fixtures used.';
    }
    if (!hasSuccess && statuses.includes('RATE_LIMITED')) {
      return 'Providers rate limited. Try later.';
    }
    if (statuses.length > 0 && !hasSuccess) {
      return 'Providers unavailable. Try later.';
    }
    if (hasSuccess && hasFailure) {
      return 'No matches; some providers unavailable.';
    }
    return 'No jobs match your current profile.';
  });
  readonly currentPage = computed(() =>
    this.activeRoleState()?.currentPage ?? 1);
  readonly totalResults = computed(() =>
    this.activeRoleState()?.totalResults ?? 0);
  readonly loading = computed(() =>
    this.activeRoleState()?.loading ?? false);
  readonly error = computed(() =>
    this.activeRoleState()?.error ?? null);
  readonly activeRoleSearched = computed(() =>
    this.activeRoleState()?.searched ?? false);
  generatingJobIds = signal<Set<string>>(new Set());
  cancellingGenerationIds = signal<Set<string>>(new Set());
  generationMessages = signal<Record<string, string | undefined>>({});
  generationErrors = signal<Record<string, string | undefined>>({});
  generationDownloads = signal<Record<string, GenerationDownloadsResponse | undefined>>({});
  generatedDocumentIds = signal<Record<string, { cvDocumentId?: string; coverLetterDocumentId?: string } | undefined>>({});
  uploadingDocuments = signal<Record<string, 'CV' | 'COVER_LETTER' | undefined>>({});
  updatingApplicationStatuses = signal<Record<string, StatusUpdateTarget | undefined>>({});
  creatingApplicationIds = signal<Set<string>>(new Set());
  loadingJobDescriptionIds = signal<Set<string>>(new Set());
  jobDescriptionErrors = signal<Record<string, string | undefined>>({});
  evidenceSelectionJob = signal<Job | null>(null);
  documentChoiceJob = signal<Job | null>(null);
  documentChoiceEntryPoint = signal<DocumentEntryPoint>('ADD');
  documentChoices = signal<Record<EvidencePurpose, DocumentChoice | null>>({
    CV: null,
    COVER_LETTER: null,
  });
  documentChoiceFiles = signal<Record<EvidencePurpose, File | null>>({
    CV: null,
    COVER_LETTER: null,
  });
  documentChoiceError = signal<string | null>(null);
  requestedGenerationOutputs = signal<EvidencePurpose[]>(['CV', 'COVER_LETTER']);
  applicationUploadStates = signal<Record<string, Partial<Record<EvidencePurpose, ApplicationUploadViewState>>>>({});
  evidenceEntries = signal<EvidenceEntry[]>([]);
  evidenceLoading = signal(false);
  evidenceSelectionError = signal<string | null>(null);
  evidenceLoadError = signal<string | null>(null);
  generationJobDetailsLoading = signal(false);
  generationJobDetailsError = signal<string | null>(null);
  generationJobDescription = signal('');
  generationJobDescriptionConfirmed = signal(false);
  generationJobDescriptionEdited = signal(false);
  generationAdvertiserName = signal('');
  generationAdvertiserType = signal<GenerationAdvertiserType>('UNKNOWN');
  generationHiringOrganisationName = signal('');
  generationApplicationContactName = signal('');
  cvEvidenceIds = signal<string[]>([]);
  coverLetterEvidenceIds = signal<string[]>([]);
  cvSectionOrder = signal<EvidenceSection[]>([]);
  coverLetterSectionOrder = signal<EvidenceSection[]>([]);
  evidenceSelectionDrafts = signal<Record<string, EvidenceSelectionDraft | undefined>>({});
  readonly jobsPerPage = 10;
  readonly Math = Math;
  readonly futureFilterSections = ['Status', 'Date Posted', 'Salary', 'Location', 'Remote / On-site'];
  readonly evidencePurposes: EvidencePurpose[] = ['CV', 'COVER_LETTER'];
  readonly activeEvidencePurposes = computed(() => this.requestedGenerationOutputs());
  readonly canContinueDocumentChoice = computed(() => {
    const choices = this.documentChoices();
    const files = this.documentChoiceFiles();
    const allowed = this.documentChoiceEntryPoint() === 'ADD'
      ? (choice: DocumentChoice | null) => choice === 'UPLOAD' || choice === 'OMIT'
      : (choice: DocumentChoice | null) => choice !== null;
    return this.evidencePurposes.every(purpose =>
      allowed(choices[purpose])
      && (choices[purpose] !== 'UPLOAD' || this.validApplicationUploadFile(files[purpose])));
  });
  readonly sortOptions: { value: SortOption; label: string }[] = [
    { value: 'MOST_RELEVANT', label: 'Best assessed match' },
    { value: 'CLOSEST', label: 'Closest to me' },
    { value: 'HIGHEST_SALARY', label: 'Highest salary' },
    { value: 'NEWEST_POSTED', label: 'Newest posted' },
    { value: 'OLDEST_POSTED', label: 'Oldest posted' },
    { value: 'COMPANY_AZ', label: 'Company A-Z' },
    { value: 'JOB_TITLE_AZ', label: 'Job title A-Z' },
  ];
  readonly futureSortOptions = ['Best match', 'Recently updated', 'Remote first', 'Most sources', 'Application status'];
  readonly eligibleEvidence = computed(() => this.evidenceEntries().filter(entry => {
    const latest = this.latestEvidence(entry);
    return entry.lifecycle === EvidenceEntryLifecycleEnum.Active
      && entry.visibility === EvidenceEntryVisibilityEnum.Visible
      && !entry.reviewRequired
      && latest?.confirmationState === EvidenceRevisionConfirmationStateEnum.UserConfirmed;
  }));
  readonly evidenceMatches = computed(() => {
    const advert = this.generationJobDescription().toLowerCase();
    const advertTerms = this.relevanceTerms(advert);
    return new Map(this.eligibleEvidence().map(entry => {
      const revision = this.latestEvidence(entry);
      if (!revision) return [entry.entryId, this.matchLabel(0, [])] as const;
      const fields = [
        revision.heading,
        revision.organisationContext,
        revision.roleTitle,
        revision.programmeOrSubject,
        revision.institution,
        revision.qualificationTitle,
        revision.issuer,
        revision.projectRole,
        revision.description,
        revision.responsibilities,
        revision.achievements,
        ...revision.demonstratedSkills,
      ].filter((value): value is string => Boolean(value));
      const evidenceTerms = this.relevanceTerms(fields.join(' '));
      const matchedTerms = [...evidenceTerms].filter(term => advertTerms.has(term));
      const matchedSkills = revision.demonstratedSkills.filter(skill =>
        advert.includes(skill.trim().toLowerCase()));
      const score = matchedTerms.length + (matchedSkills.length * 6);
      const reasons = [...new Set([...matchedSkills, ...matchedTerms])].slice(0, 4);
      return [entry.entryId, this.matchLabel(score, reasons)] as const;
    }));
  });
  readonly rankedEligibleEvidence = computed(() => [...this.eligibleEvidence()].sort((left, right) => {
    const scoreDifference = (this.evidenceMatches().get(right.entryId)?.score ?? 0)
      - (this.evidenceMatches().get(left.entryId)?.score ?? 0);
    if (scoreDifference !== 0) return scoreDifference;
    return (this.latestEvidence(left)?.heading ?? '')
      .localeCompare(this.latestEvidence(right)?.heading ?? '');
  }));
  readonly ineligibleEvidenceCount = computed(() =>
    this.evidenceEntries().length - this.eligibleEvidence().length);
  readonly generationJobDescriptionLooksIncomplete = computed(() => {
    if (!this.generationJobDescriptionEdited()
        && this.evidenceSelectionJob()?.descriptionCompleteness
          === JobDescriptionCompletenessEnum.Full) {
      return false;
    }
    const description = this.generationJobDescription().trim();
    return description.length < 600
      || /(?:\.\.\.|…|\bTHE\s+(?:ROL|ROLE)\s*)$/i.test(description);
  });
  readonly generationJobDescriptionNeedsConfirmation = computed(() =>
    this.generationJobDescriptionEdited()
    || this.evidenceSelectionJob()?.descriptionCompleteness
      !== JobDescriptionCompletenessEnum.Full);
  readonly generationJobDescriptionStatus = computed(() => {
    if (this.generationJobDescriptionEdited()) return 'Edited by you';
    switch (this.evidenceSelectionJob()?.descriptionCompleteness) {
      case JobDescriptionCompletenessEnum.Full:
        return 'Complete provider advert';
      case JobDescriptionCompletenessEnum.Preview:
        return 'Provider preview';
      case JobDescriptionCompletenessEnum.UserConfirmed:
        return 'Confirmed by you';
      default:
        return 'Completeness unknown';
    }
  });
  readonly generationNhsPreview = computed(() =>
    this.isNhsJobsPreview(this.evidenceSelectionJob()));
  readonly generationNhsOfficialAdvertUrl = computed(() =>
    this.nhsOfficialAdvertUrl(this.evidenceSelectionJob()));
  readonly canGenerateFromSelection = computed(() =>
    !this.evidenceLoading()
    && !this.evidenceLoadError()
    && !this.generationJobDetailsLoading()
    && (!this.generationJobDescriptionNeedsConfirmation()
      || this.generationJobDescriptionConfirmed())
    && this.generationJobDescription().trim().length >= 200
    && this.generationAdvertiserName().trim().length > 0
    && this.generationAdvertiserType() !== 'UNKNOWN'
    && this.activeEvidencePurposes().every(purpose => this.validEvidenceSelection(
      purpose === 'CV' ? this.cvEvidenceIds() : this.coverLetterEvidenceIds(),
      purpose === 'CV' ? this.cvSectionOrder() : this.coverLetterSectionOrder(),
    )));

  activeJobs = computed(() => {
    const state = this.activeRoleState();
    return state?.pages[state.currentPage]?.jobs ?? [];
  });

  publisherOptions = computed(() => {
    const counts = new Map<string, number>();
    for (const job of this.activeJobs()) {
      for (const publisher of this.publishersForJob(job)) {
        counts.set(publisher, (counts.get(publisher) ?? 0) + 1);
      }
    }
    const preferredOrder = ['NHS Jobs', 'Find an apprenticeship', 'Reed.co.uk', 'Adzuna', 'Indeed', 'LinkedIn', 'Employer Sites', 'Other'];
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
    const index = new Map(jobs.map((job, position) => [this.jobStateKey(job) || String(position), position]));
    return [...jobs].sort((left, right) => {
      const comparison = this.compareJobs(left, right);
      if (comparison !== 0) {
        return comparison;
      }
      return (index.get(this.jobStateKey(left)) ?? 0) - (index.get(this.jobStateKey(right)) ?? 0);
    });
  });

  totalPages = computed(() => this.activeRoleState()?.totalPages ?? 1);
  hasMore = computed(() => this.activeRoleState()?.hasMore ?? false);
  paginatedJobs = computed(() => this.sortedJobs());
  resultRangeStart = computed(() => {
    const state = this.activeRoleState();
    return state && this.activeJobs().length > 0
      ? ((state.currentPage - 1) * state.pageSize) + 1
      : 0;
  });
  resultRangeEnd = computed(() => Math.min(
    this.totalResults(),
    this.resultRangeStart() + Math.max(0, this.activeJobs().length - 1),
  ));

  ngOnInit(): void {
    this.applicationTracker.listApplications().subscribe({
      next: records => {
        for (const record of records) {
          const jobId = record.canonicalJobId ?? record.jobId;
          if (!jobId) continue;
          this.applyApplicationRecord(jobId, record);
        }
        this.search();
      },
      error: () => this.search(),
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    for (const subscription of this.generationSubscriptions.values()) {
      subscription.unsubscribe();
    }
    for (const subscription of this.cancellationSubscriptions.values()) {
      subscription.unsubscribe();
    }
    for (const subscription of this.applicationUploadSubscriptions.values()) {
      subscription.unsubscribe();
    }
    this.generationSubscriptions.clear();
    this.cancellationSubscriptions.clear();
    this.applicationUploadSubscriptions.clear();
    this.activeGenerationIds.clear();
  }

  trackByJobId(index: number, job: Job): string {
    return job.id ?? job.canonicalJobId ?? String(index);
  }

  jobStateKey(job: Job): string {
    return job.canonicalJobId ?? job.id ?? '';
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

    return {
      ...job,
      description: providerPlainText(job.description),
    };
  }

  search(): void {
    const contextChanged = this.synchroniseSearchContext();
    const active = this.activeRoleState();
    if (!active) return;
    if (contextChanged || !active.searched) {
      this.loadRolePage(active.key, active.currentPage, true);
    }
  }

  refresh(): void {
    const contextChanged = this.synchroniseSearchContext();
    const active = this.activeRoleState();
    if (!active) return;
    this.loadRolePage(active.key, active.currentPage, true);
    if (contextChanged) {
      this.selectedPublisher.set('All Job Sites');
      this.filtersOpen.set(false);
    }
  }

  loadFullJobDescription(job: Job): void {
    const jobId = this.jobStateKey(job);
    if (!jobId || this.loadingJobDescriptionIds().has(jobId)) return;
    const provider = job.primarySource?.trim() || job.provider?.trim();
    const externalJobId = job.externalJobId?.trim();
    if (!provider || !externalJobId) {
      this.jobDescriptionErrors.update(errors => ({
        ...errors,
        [jobId]: 'The provider did not supply a reference for loading the complete advert.',
      }));
      return;
    }

    this.loadingJobDescriptionIds.update(ids => new Set(ids).add(jobId));
    this.jobDescriptionErrors.update(errors => ({...errors, [jobId]: undefined}));
    this.jobService.getJobDetails(provider, externalJobId)
      .pipe(finalize(() => this.loadingJobDescriptionIds.update(ids => {
        const next = new Set(ids);
        next.delete(jobId);
        return next;
      })))
      .subscribe({
        next: details => {
          this.updateJobLocally(jobId, {
            ...details,
            id: job.id,
            canonicalJobId: job.canonicalJobId,
          });
        },
        error: () => this.jobDescriptionErrors.update(errors => ({
          ...errors,
          [jobId]: 'The complete provider advert could not be loaded. Please try again.',
        })),
      });
  }

  private synchroniseSearchContext(): boolean {
    const roles = this.targetRoles();
    const fingerprint = JSON.stringify({
      roles,
      skills: this.skills(),
      experience: this.experience(),
      workPrefs: this.workPrefs(),
    });
    if (fingerprint === this.searchContextFingerprint) {
      return false;
    }

    this.searchContextFingerprint = fingerprint;
    const states = Object.fromEntries(roles.map(targetRole => {
      const key = this.roleKey(targetRole);
      return [key, this.emptyRoleState(key, targetRole)];
    }));
    this.roleStates.set(states);
    this.roleOrder.set(roles.map(role => this.roleKey(role)));
    this.selectedTargetRole.set(roles[0] ?? '');
    this.selectedPublisher.set('All Job Sites');
    this.filtersOpen.set(false);
    this.reconcileGeneratedState([]);
    return true;
  }

  private targetRoles(): string[] {
    const roles = this.aspirations()
      .split(',')
      .map(role => role.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    return roles.filter(role => {
      const key = this.roleKey(role);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private roleKey(targetRole: string): string {
    return targetRole.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private emptyRoleState(key: string, targetRole: string): RoleSearchState {
    return {
      key,
      targetRole,
      pages: {},
      currentPage: 1,
      pageSize: this.jobsPerPage,
      totalResults: 0,
      totalPages: 1,
      hasMore: false,
      providerStatuses: [],
      providerWarnings: [],
      searchStatus: null,
      matchingStatus: null,
      freshness: null,
      qualitySummary: null,
      providerResults: [],
      loading: false,
      error: null,
      searched: false,
      requestSequence: 0,
      sort: 'MOST_RELEVANT',
    };
  }

  private loadRolePage(roleKey: string, page: number, force: boolean): void {
    const state = this.roleStates()[roleKey];
    if (!state) return;
    const requestedPage = Math.max(1, page);
    const cachedPage = state.pages[requestedPage];
    if (cachedPage && !force) {
      this.updateRoleState(roleKey, current => ({
        ...current,
        currentPage: requestedPage,
        hasMore: requestedPage < current.totalPages,
        providerStatuses: cachedPage.providerStatuses,
        providerWarnings: cachedPage.providerWarnings,
        searchStatus: cachedPage.searchStatus,
        matchingStatus: cachedPage.matchingStatus,
        freshness: cachedPage.freshness,
        qualitySummary: cachedPage.qualitySummary,
        providerResults: cachedPage.providerResults,
        error: null,
      }));
      return;
    }

    const requestSequence = ++this.searchRequestSequence;
    this.updateRoleState(roleKey, current => ({
      ...current,
      loading: true,
      error: null,
      requestSequence,
    }));

    this.jobService.searchJobs(
      this.skills(),
      this.experience(),
      this.aspirations(),
      this.workPrefs(),
      {
        targetRole: state.targetRole,
        page: requestedPage,
        pageSize: state.pageSize,
        sort: state.sort,
      },
    ).subscribe({
      next: response => this.acceptRolePage(roleKey, requestSequence, requestedPage, response),
      error: err => this.rejectRolePage(roleKey, requestSequence, err),
    });
  }

  private acceptRolePage(
    roleKey: string,
    requestSequence: number,
    requestedPage: number,
    response: JobSearchResponse,
  ): void {
    const current = this.roleStates()[roleKey];
    if (!current || current.requestSequence !== requestSequence) return;

    const roleGroups = response.resultsByTargetRole ?? [];
    const matchingGroup = roleGroups.find(group =>
      this.roleKey(group.targetRole ?? '') === roleKey);
    if (roleGroups.length > 0 && !matchingGroup) {
      const message = 'Search results for this target role could not be verified. Please try again.';
      this.updateRoleState(roleKey, state => state.requestSequence !== requestSequence
        ? state
        : {
            ...state,
            loading: false,
            error: message,
            searched: true,
            providerStatuses: ['UNAVAILABLE'],
            providerWarnings: [],
            searchStatus: 'UNAVAILABLE',
            matchingStatus: 'UNAVAILABLE',
            freshness: null,
            qualitySummary: null,
            providerResults: [],
          });
      if (this.roleKey(this.selectedTargetRole()) === roleKey) {
        this.notify.emit({message, type: 'error'});
      }
      return;
    }
    const responseJobs = matchingGroup?.jobs
      ?? response.jobs
      ?? [];
    const validJobs = responseJobs
      .flatMap(job => {
        const validated = this.validateJob(job);
        if (validated) return [validated];
        return [];
      })
      .map(job => this.reconcilePersistedApplication(job))
      .map(job => this.preserveNewerLocalApplicationState(job, requestSequence));

    const responsePage = Math.max(
      1,
      matchingGroup?.page ?? response.page ?? requestedPage,
    );
    const responsePageSize = Math.max(
      1,
      matchingGroup?.pageSize ?? response.pageSize ?? current.pageSize,
    );
    const deduplicatedJobs = this.removeCrossPageDuplicates(
      current,
      responsePage,
      validJobs,
    );
    const minimumTotal = ((responsePage - 1) * responsePageSize) + deduplicatedJobs.length;
    const totalResults = Math.max(
      0,
      matchingGroup?.totalResults ?? response.totalResults ?? minimumTotal,
    );
    const totalPages = Math.max(
      1,
      matchingGroup?.totalPages
        ?? response.totalPages
        ?? Math.ceil(totalResults / responsePageSize),
    );
    const providerResults = matchingGroup?.providerResults
      ?? response.providerResults
      ?? [];
    const providerStatuses = providerResults
      .map(result => result.status ?? 'UNAVAILABLE');
    const providerWarnings = Array.from(new Set(
      providerResults
        .filter(result => result.status !== 'SUCCESS' && result.status !== 'DISABLED')
        .map(result => this.providerWarning(
          result.provider ?? 'A job provider',
          result.status ?? 'UNAVAILABLE',
        )),
    ));
    const searchStatus = matchingGroup?.searchStatus
      ?? response.searchStatus
      ?? null;
    const matchingStatus = matchingGroup?.matchingStatus
      ?? response.matchingStatus
      ?? null;
    const freshness = response.freshness ?? null;
    const qualitySummary = matchingGroup?.qualitySummary
      ?? response.qualitySummary
      ?? null;
    const pageCache: RolePageCache = {
      jobs: deduplicatedJobs,
      providerStatuses,
      providerWarnings,
      searchStatus,
      matchingStatus,
      freshness,
      qualitySummary,
      providerResults,
    };

    this.updateRoleState(roleKey, state => {
      if (state.requestSequence !== requestSequence) return state;
      const pages = {
        ...state.pages,
        [responsePage]: pageCache,
      };
      for (const cachedPage of Object.keys(pages).map(Number)) {
        if (cachedPage > totalPages) delete pages[cachedPage];
      }
      return {
        ...state,
        pages,
        currentPage: responsePage,
        pageSize: responsePageSize,
        totalResults,
        totalPages,
        hasMore: responsePage < totalPages,
        providerStatuses,
        providerWarnings,
        searchStatus,
        matchingStatus,
        freshness,
        qualitySummary,
        providerResults,
        loading: false,
        error: null,
        searched: true,
      };
    });

    this.reconcileGeneratedState(this.jobs());
    this.rehydrateGeneratedDownloads(deduplicatedJobs);
    this.restorePendingGenerations(this.jobs());
    if (this.roleKey(this.selectedTargetRole()) === roleKey) {
      this.notify.emit({
        message: `Found ${totalResults} matching job${totalResults === 1 ? '' : 's'} for ${current.targetRole}.`,
        type: 'success',
      });
    }
  }

  private rejectRolePage(roleKey: string, requestSequence: number, err: {status?: number}): void {
    const current = this.roleStates()[roleKey];
    if (!current || current.requestSequence !== requestSequence) return;
    const message = this.searchErrorMessage(err.status);
    this.updateRoleState(roleKey, state => state.requestSequence !== requestSequence
      ? state
      : {
          ...state,
          loading: false,
          error: message,
          searched: true,
          providerStatuses: ['UNAVAILABLE'],
          providerWarnings: [],
          searchStatus: 'UNAVAILABLE',
          matchingStatus: 'UNAVAILABLE',
          freshness: null,
          qualitySummary: null,
          providerResults: [],
        });
    if (this.roleKey(this.selectedTargetRole()) === roleKey) {
      this.notify.emit({message, type: 'error'});
    }
  }

  private searchErrorMessage(status: number | undefined): string {
    if (status === 503) {
      return 'Job search is unavailable. Try again later.';
    }
    if (status === 400) {
      return 'Invalid search. Update your profile and try again.';
    }
    if (status === 401 || status === 403) {
      return 'Session expired. Sign in.';
    }
    return 'Search failed.';
  }

  private removeCrossPageDuplicates(
    state: RoleSearchState,
    page: number,
    jobs: Job[],
  ): Job[] {
    const otherPageIds = new Set(
      Object.entries(state.pages)
        .filter(([cachedPage]) => Number(cachedPage) !== page)
        .flatMap(([, cached]) => cached.jobs)
        .map(job => this.jobStateKey(job))
        .filter(Boolean),
    );
    const pageIds = new Set<string>();
    return jobs.filter(job => {
      const key = this.jobStateKey(job);
      if (!key || otherPageIds.has(key) || pageIds.has(key)) return false;
      pageIds.add(key);
      return true;
    });
  }

  private updateRoleState(
    roleKey: string,
    update: (state: RoleSearchState) => RoleSearchState,
  ): void {
    this.roleStates.update(states => {
      const state = states[roleKey];
      if (!state) return states;
      return {
        ...states,
        [roleKey]: update(state),
      };
    });
  }

  private allCachedJobs(): Job[] {
    const uniqueJobs = new Map<string, Job>();
    for (const key of this.roleOrder()) {
      const state = this.roleStates()[key];
      if (!state) continue;
      for (const page of Object.values(state.pages)) {
        for (const job of page.jobs) {
          const jobKey = this.jobStateKey(job);
          if (jobKey) uniqueJobs.set(jobKey, job);
        }
      }
    }
    return Array.from(uniqueJobs.values());
  }

  private providerWarning(provider: string, status: string): string {
    const providerName = provider || 'A job provider';
    switch (status) {
      case 'RATE_LIMITED':
        return `${providerName} has reached its current request limit. Results from other job sites are still shown.`;
      case 'CONFIGURATION_ERROR':
        return `${providerName} needs provider-account validation. Results from other job sites are still shown.`;
      case 'TIMED_OUT':
        return `${providerName} timed out. Results from other job sites are still shown.`;
      case 'SATURATED':
        return `${providerName} is currently at capacity. Results from other job sites are still shown.`;
      case 'REJECTED':
        return `${providerName} rejected this search. Results from other job sites are still shown.`;
      default:
        return `${providerName} was temporarily unavailable. Results from other job sites are still shown.`;
    }
  }

  private cacheAgeLabel(cacheAgeSeconds: number | null | undefined): string {
    if (cacheAgeSeconds == null || cacheAgeSeconds < 0) return '';
    if (cacheAgeSeconds < 60) return ` · ${Math.round(cacheAgeSeconds)}s old`;
    return ` · ${Math.round(cacheAgeSeconds / 60)}m old`;
  }

  private filteredCountLabel(count: number, noun: string): string | null {
    if (!Number.isFinite(count) || count <= 0) return null;
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
  }

  selectTargetRole(targetRole: string): void {
    if (targetRole === this.selectedTargetRole()) return;
    this.selectedTargetRole.set(targetRole);
    this.selectedPublisher.set('All Job Sites');
    const state = this.roleStates()[this.roleKey(targetRole)];
    if (state && !state.searched && !state.loading) {
      this.loadRolePage(state.key, state.currentPage, false);
    }
  }

  selectPublisher(publisher: string): void {
    if (publisher === this.selectedPublisher()) return;
    this.selectedPublisher.set(publisher);
  }

  selectSort(value: string): void {
    const sort = value as SortOption;
    const state = this.activeRoleState();
    if (!state || state.sort === sort) return;
    this.updateRoleState(state.key, current => ({
      ...current,
      pages: {},
      currentPage: 1,
      totalResults: 0,
      totalPages: 1,
      hasMore: false,
      providerStatuses: [],
      providerWarnings: [],
      searchStatus: null,
      matchingStatus: null,
      freshness: null,
      qualitySummary: null,
      providerResults: [],
      loading: false,
      error: null,
      searched: false,
      sort,
    }));
    this.loadRolePage(state.key, 1, true);
  }

  toggleFilters(): void {
    this.filtersOpen.update(open => !open);
  }

  previousPage(): void {
    const state = this.activeRoleState();
    if (!state || state.loading || state.currentPage <= 1) return;
    this.loadRolePage(state.key, state.currentPage - 1, false);
  }

  nextPage(): void {
    const state = this.activeRoleState();
    if (!state || state.loading || !state.hasMore) return;
    this.loadRolePage(state.key, Math.min(state.totalPages, state.currentPage + 1), false);
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

  openEvidenceSelection(job: Job): void {
    const jobKey = this.jobStateKey(job);
    if (!jobKey || this.generatingJobIds().has(jobKey)) return;
    this.persistEvidenceDraft();
    this.evidenceSelectionJob.set(job);
    this.generationJobDescription.set(job.description?.trim() ?? '');
    this.generationJobDescriptionEdited.set(false);
    this.generationJobDescriptionConfirmed.set(
      job.descriptionCompleteness === JobDescriptionCompletenessEnum.Full,
    );
    const generationJob = job as GenerationJob;
    const advertiserName = generationJob.advertiserName?.trim()
      || job.companyName?.trim()
      || job.company?.trim()
      || '';
    this.generationAdvertiserName.set(advertiserName);
    this.generationAdvertiserType.set(
      generationJob.advertiserType && generationJob.advertiserType !== 'UNKNOWN'
        ? generationJob.advertiserType
        : /recruit/i.test(advertiserName)
          ? 'RECRUITER'
          : 'EMPLOYER',
    );
    this.generationHiringOrganisationName.set(
      generationJob.hiringOrganisationName?.trim() ?? '',
    );
    this.generationApplicationContactName.set(
      generationJob.applicationContactName?.trim() ?? '',
    );
    this.restoreEvidenceDraft(jobKey);
    this.evidenceEntries.set([]);
    this.evidenceSelectionError.set(null);
    this.evidenceLoadError.set(null);
    this.generationJobDetailsError.set(null);
    this.loadEvidenceForSelection(jobKey);
    this.loadJobDetailsForSelection(job, jobKey);
  }

  retryJobDetails(): void {
    const job = this.evidenceSelectionJob();
    const jobKey = job ? this.jobStateKey(job) : '';
    if (!job || !jobKey || this.generationJobDetailsLoading()) return;
    this.loadJobDetailsForSelection(job, jobKey, true);
  }

  private loadJobDetailsForSelection(
    job: Job,
    jobKey: string,
    force = false,
  ): void {
    if (!force
        && job.descriptionCompleteness === JobDescriptionCompletenessEnum.Full) {
      this.generationJobDetailsLoading.set(false);
      return;
    }
    const provider = job.primarySource?.trim() || job.provider?.trim();
    const externalJobId = job.externalJobId?.trim();
    if (!provider || !externalJobId) {
      this.generationJobDetailsLoading.set(false);
      this.generationJobDetailsError.set(
        'This result has no provider reference, so its advert could not be refreshed automatically.',
      );
      return;
    }
    const requestSequence = ++this.jobDetailsRequestSequence;
    this.generationJobDetailsLoading.set(true);
    this.generationJobDetailsError.set(null);
    this.jobService.getJobDetails(provider, externalJobId).subscribe({
      next: details => {
        if (!this.isCurrentJobDetailsRequest(jobKey, requestSequence)) return;
        const safeDetails: Job = this.isNhsJobsPreview(job)
          ? {
              ...details,
              descriptionCompleteness: details.description?.trim()
                ? JobDescriptionCompletenessEnum.Preview
                : JobDescriptionCompletenessEnum.Unknown,
            }
          : details;
        // Provider detail records use the provider's raw identifier. Keep the
        // search result identity stable so the inline panel remains attached
        // to the card that opened it while applying the richer advert fields.
        const hydratedJob: Job = {
          ...job,
          ...safeDetails,
          id: job.id,
          canonicalJobId: job.canonicalJobId,
        };
        this.evidenceSelectionJob.set(hydratedJob);
        if (!this.generationJobDescriptionEdited()) {
          this.generationJobDescription.set(safeDetails.description?.trim() ?? '');
          this.generationJobDescriptionConfirmed.set(
            safeDetails.descriptionCompleteness
              === JobDescriptionCompletenessEnum.Full,
          );
        }
        this.generationJobDetailsLoading.set(false);
      },
      error: () => {
        if (!this.isCurrentJobDetailsRequest(jobKey, requestSequence)) return;
        this.generationJobDetailsLoading.set(false);
        if (this.isNhsJobsPreview(job)) {
          this.generationJobDetailsError.set(null);
          this.generationJobDescriptionConfirmed.set(false);
          return;
        }
        this.generationJobDetailsError.set(
          'The provider advert could not be refreshed automatically. You can retry or review and complete the editable text below.',
        );
      },
    });
  }

  private isNhsJobsPreview(job: Job | null): boolean {
    if (!job) return false;
    const provider = job.primarySource?.trim() || job.provider?.trim();
    return provider?.toUpperCase() === 'NHS_JOBS'
      && job.descriptionCompleteness !== JobDescriptionCompletenessEnum.Full;
  }

  private nhsOfficialAdvertUrl(job: Job | null): string | null {
    if (!this.isNhsJobsPreview(job) || !job) return null;
    for (const source of job.sources ?? []) {
      for (const candidate of [source.listingUrl, source.applyUrl]) {
        const approved = approvedNhsJobsAdvertUrl(candidate);
        if (approved) return approved;
      }
    }
    return approvedNhsJobsAdvertUrl(job.sourceUrl)
      ?? approvedNhsJobsAdvertUrl(job.url);
  }

  retryEvidenceSelection(): void {
    const job = this.evidenceSelectionJob();
    const jobKey = job ? this.jobStateKey(job) : '';
    if (!jobKey || this.evidenceLoading()) return;
    this.loadEvidenceForSelection(jobKey);
  }

  private loadEvidenceForSelection(jobKey: string): void {
    const requestSequence = ++this.evidenceRequestSequence;
    this.evidenceLoading.set(true);
    this.evidenceLoadError.set(null);
    this.evidenceLibrary.listEvidence(false, 'body', false, {transferCache: false}).subscribe({
      next: entries => {
        if (!this.isCurrentEvidenceRequest(jobKey, requestSequence)) return;
        this.evidenceEntries.set(entries);
        this.reconcileEvidenceSelection();
        this.evidenceLoading.set(false);
      },
      error: () => {
        if (!this.isCurrentEvidenceRequest(jobKey, requestSequence)) return;
        this.evidenceLoading.set(false);
        this.evidenceLoadError.set(
          'Your confirmed experience and achievements could not be loaded. Please try again.',
        );
      },
    });
  }

  closeEvidenceSelection(): void {
    this.persistEvidenceDraft();
    this.evidenceRequestSequence++;
    this.jobDetailsRequestSequence++;
    this.evidenceSelectionJob.set(null);
    this.evidenceEntries.set([]);
    this.evidenceLoading.set(false);
    this.evidenceSelectionError.set(null);
    this.evidenceLoadError.set(null);
    this.generationJobDetailsLoading.set(false);
    this.generationJobDetailsError.set(null);
    this.generationJobDescription.set('');
    this.generationJobDescriptionConfirmed.set(false);
    this.generationJobDescriptionEdited.set(false);
    this.resetGenerationJobParties();
  }

  updateGenerationJobDescription(event: Event): void {
    const value = event.target instanceof HTMLTextAreaElement
      ? event.target.value
      : '';
    this.generationJobDescription.set(value.slice(0, 12_000));
    this.generationJobDescriptionEdited.set(true);
    this.generationJobDescriptionConfirmed.set(false);
    this.evidenceSelectionError.set(null);
  }

  updateGenerationJobDescriptionConfirmation(event: Event): void {
    const confirmed = event.target instanceof HTMLInputElement
      && event.target.checked;
    this.generationJobDescriptionConfirmed.set(confirmed);
    this.evidenceSelectionError.set(null);
  }

  latestEvidence(entry: EvidenceEntry): EvidenceRevision | undefined {
    return [...entry.revisions].sort((left, right) =>
      right.revisionNumber - left.revisionNumber)[0];
  }

  evidenceMatch(entry: EvidenceEntry): EvidenceMatch {
    return this.evidenceMatches().get(entry.entryId)
      ?? this.matchLabel(0, []);
  }

  selectedEvidence(purpose: EvidencePurpose): EvidenceEntry[] {
    const ids = purpose === 'CV' ? this.cvEvidenceIds() : this.coverLetterEvidenceIds();
    const entries = new Map(this.eligibleEvidence().map(entry => [entry.entryId, entry]));
    return ids.map(id => entries.get(id)).filter((entry): entry is EvidenceEntry => Boolean(entry));
  }

  isEvidenceSelected(purpose: EvidencePurpose, entryId: string): boolean {
    return (purpose === 'CV' ? this.cvEvidenceIds() : this.coverLetterEvidenceIds())
      .includes(entryId);
  }

  toggleEvidence(purpose: EvidencePurpose, entry: EvidenceEntry): void {
    if (!this.eligibleEvidence().some(candidate => candidate.entryId === entry.entryId)) return;
    const selected = purpose === 'CV' ? this.cvEvidenceIds : this.coverLetterEvidenceIds;
    const sections = purpose === 'CV' ? this.cvSectionOrder : this.coverLetterSectionOrder;
    const current = selected();
    const removing = current.includes(entry.entryId);
    const next = removing
      ? current.filter(id => id !== entry.entryId)
      : [...current, entry.entryId];
    selected.set(next);

    const category = entry.category as unknown as EvidenceSection;
    const selectedCategories = new Set(
      this.eligibleEvidence()
        .filter(candidate => next.includes(candidate.entryId))
        .map(candidate => candidate.category as unknown as EvidenceSection),
    );
    sections.update(order => {
      if (!removing && !order.includes(category)) return [...order, category];
      return order.filter(section => selectedCategories.has(section));
    });
    this.persistEvidenceDraft();
  }

  allEvidenceSelected(purpose: EvidencePurpose): boolean {
    const eligibleIds = this.eligibleEvidence().map(entry => entry.entryId);
    const selectedIds = purpose === 'CV' ? this.cvEvidenceIds() : this.coverLetterEvidenceIds();
    return eligibleIds.length > 0
      && eligibleIds.every(entryId => selectedIds.includes(entryId));
  }

  toggleAllEvidence(purpose: EvidencePurpose): void {
    const selected = purpose === 'CV' ? this.cvEvidenceIds : this.coverLetterEvidenceIds;
    const sections = purpose === 'CV' ? this.cvSectionOrder : this.coverLetterSectionOrder;
    if (this.allEvidenceSelected(purpose)) {
      selected.set([]);
      sections.set([]);
      this.persistEvidenceDraft();
      return;
    }

    const entries = this.rankedEligibleEvidence();
    selected.set(entries.map(entry => entry.entryId));
    sections.set(Array.from(new Set(entries.map(entry =>
      entry.category as unknown as EvidenceSection))));
    this.persistEvidenceDraft();
  }

  applyRecommendedEvidence(purpose: EvidencePurpose): void {
    const recommended = this.recommendedEvidence(purpose);
    const selected = purpose === 'CV' ? this.cvEvidenceIds : this.coverLetterEvidenceIds;
    const sections = purpose === 'CV' ? this.cvSectionOrder : this.coverLetterSectionOrder;
    selected.set(recommended.map(entry => entry.entryId));
    sections.set(Array.from(new Set(recommended.map(entry =>
      entry.category as unknown as EvidenceSection))));
    this.persistEvidenceDraft();
  }

  recommendedEvidence(purpose: EvidencePurpose): EvidenceEntry[] {
    const limit = purpose === 'CV' ? 7 : 4;
    const candidates = this.rankedEligibleEvidence()
      .filter(entry => entry.category !== EvidenceEntryCategoryEnum.CareerBreak);
    const relevant = candidates.filter(entry => this.evidenceMatch(entry).score > 0);
    const pool = relevant.length ? relevant : candidates;
    const recommended = pool.slice(0, limit);
    const strongestCore = candidates.find(entry => this.isSubstantialCoreEvidence(entry));
    if (strongestCore && !recommended.some(entry => entry.entryId === strongestCore.entryId)) {
      recommended.unshift(strongestCore);
      recommended.splice(limit);
    }
    if (purpose === 'CV') {
      const education = candidates.find(entry =>
        entry.category === EvidenceEntryCategoryEnum.Education
        || entry.category === EvidenceEntryCategoryEnum.QualificationTraining);
      if (education && !recommended.some(entry => entry.entryId === education.entryId)) {
        if (recommended.length >= limit) recommended.pop();
        recommended.push(education);
      }
    }
    return recommended;
  }

  recommendedEvidenceSelected(purpose: EvidencePurpose): boolean {
    const current = purpose === 'CV' ? this.cvEvidenceIds() : this.coverLetterEvidenceIds();
    const recommended = this.recommendedEvidence(purpose).map(entry => entry.entryId);
    return recommended.length > 0
      && current.length === recommended.length
      && recommended.every(entryId => current.includes(entryId));
  }

  evidenceSectionPreview(purpose: EvidencePurpose): EvidenceSectionPreview[] {
    const selected = this.selectedEvidence(purpose);
    const bySection = new Map<EvidenceSection, string[]>();
    for (const entry of selected) {
      const section = entry.category as unknown as EvidenceSection;
      const headings = bySection.get(section) ?? [];
      const heading = this.latestEvidence(entry)?.heading?.trim();
      if (heading) headings.push(heading);
      bySection.set(section, headings);
    }
    return this.sectionOrder(purpose)
      .filter(section => bySection.has(section))
      .map(section => ({section, headings: bySection.get(section) ?? []}));
  }

  evidenceSelectionWarnings(purpose: EvidencePurpose): string[] {
    const selected = this.selectedEvidence(purpose);
    if (!selected.length) return [];
    const warnings: string[] = [];
    const totalNarrative = selected.reduce((total, entry) =>
      total + this.evidenceNarrativeLength(entry), 0);
    if (!selected.some(entry => this.isSubstantialCoreEvidence(entry))) {
      warnings.push('No substantial employment, freelance or project narrative is selected. The document may lack convincing delivery evidence.');
    }
    const minimumNarrative = purpose === 'CV' ? 400 : 180;
    if (totalNarrative < minimumNarrative) {
      warnings.push(`${this.documentPurposeLabel(purpose)} evidence looks sparse. Add confirmed responsibilities, achievements or project detail before generating.`);
    }
    const duplicateGroups = this.selectedDuplicateEvidence(selected);
    if (duplicateGroups.length) {
      warnings.push(`Possible duplicate evidence selected: ${duplicateGroups.join('; ')}. Review the entries rather than including the same work twice.`);
    }
    const maximum = purpose === 'CV' ? 10 : 7;
    if (selected.length > maximum) {
      warnings.push(`This selection contains ${selected.length} entries and may dilute the strongest evidence. Consider a more focused document.`);
    }
    return warnings;
  }

  moveEvidenceSection(
    purpose: EvidencePurpose,
    section: EvidenceSection,
    direction: -1 | 1,
  ): void {
    const sections = purpose === 'CV' ? this.cvSectionOrder : this.coverLetterSectionOrder;
    sections.update(order => this.move(order, section, direction));
    this.persistEvidenceDraft();
  }

  sectionOrder(purpose: EvidencePurpose): EvidenceSection[] {
    return purpose === 'CV' ? this.cvSectionOrder() : this.coverLetterSectionOrder();
  }

  categoryLabel(category: string): string {
    return category.toLowerCase().replaceAll('_', ' ')
      .replace(/\b\w/g, character => character.toUpperCase());
  }

  private relevanceTerms(value: string): Set<string> {
    return new Set((value.toLowerCase().match(/[a-z0-9+#.]{3,}/g) ?? [])
      .map(term => term.replace(/^\.+|\.+$/g, ''))
      .filter(Boolean)
      .filter(term => !MATCH_STOP_WORDS.has(term)));
  }

  private matchLabel(score: number, reasons: string[]): EvidenceMatch {
    const label = score >= 10
      ? 'Strong advert match'
      : score >= 4
        ? 'Relevant to advert'
        : score > 0
          ? 'Possible advert match'
          : 'No obvious keyword match';
    return {
      score,
      label,
      explanation: reasons.length
        ? `Matched: ${reasons.join(', ')}`
        : 'Review manually; no distinctive advert terms matched.',
    };
  }

  private isSubstantialCoreEvidence(entry: EvidenceEntry): boolean {
    return [
      EvidenceEntryCategoryEnum.Employment,
      EvidenceEntryCategoryEnum.Freelance,
      EvidenceEntryCategoryEnum.Project,
    ].includes(entry.category)
      && this.evidenceNarrativeLength(entry) >= 120;
  }

  private evidenceNarrativeLength(entry: EvidenceEntry): number {
    const revision = this.latestEvidence(entry);
    if (!revision) return 0;
    return [revision.description, revision.responsibilities, revision.achievements]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(' ')
      .trim().length;
  }

  private selectedDuplicateEvidence(entries: EvidenceEntry[]): string[] {
    const groups = new Map<string, EvidenceEntry[]>();
    for (const entry of entries) {
      const revision = this.latestEvidence(entry);
      if (!revision) continue;
      const organisation = this.normalisedEvidenceIdentity(
        revision.organisationContext || revision.heading,
      );
      if (!organisation) continue;
      const start = revision.startDate
        ? `${revision.startDate.year}-${revision.startDate.month ?? 0}`
        : '';
      const end = revision.ongoing
        ? 'ongoing'
        : revision.endDate
          ? `${revision.endDate.year}-${revision.endDate.month ?? 0}`
          : '';
      const key = `${organisation}|${start}|${end}`;
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    return [...groups.values()]
      .filter(group => group.length > 1
        && new Set(group.map(entry => entry.category)).size > 1)
      .map(group => group.map(entry => this.latestEvidence(entry)?.heading)
        .filter((heading): heading is string => Boolean(heading))
        .join(' / '));
  }

  private normalisedEvidenceIdentity(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  private resetGenerationJobParties(): void {
    this.generationAdvertiserName.set('');
    this.generationAdvertiserType.set('UNKNOWN');
    this.generationHiringOrganisationName.set('');
    this.generationApplicationContactName.set('');
  }

  isEvidenceSelectionJob(job: Job): boolean {
    const active = this.evidenceSelectionJob();
    return Boolean(active && this.jobStateKey(active) === this.jobStateKey(job));
  }

  isDocumentChoiceJob(job: Job): boolean {
    const active = this.documentChoiceJob();
    return Boolean(active && this.jobStateKey(active) === this.jobStateKey(job));
  }

  hasApplicationUploadState(job: Job): boolean {
    return Boolean(Object.keys(this.applicationUploadStates()[this.jobStateKey(job)] ?? {}).length);
  }

  applicationUploadState(
    job: Job,
    purpose: EvidencePurpose,
  ): ApplicationUploadViewState | undefined {
    return this.applicationUploadStates()[this.jobStateKey(job)]?.[purpose];
  }

  prepareApplicationDocuments(job: Job, entryPoint: DocumentEntryPoint): void {
    const jobId = this.jobStateKey(job);
    if (!jobId || this.creatingApplicationIds().has(jobId)) return;
    if (job.applicationId) {
      this.openDocumentChoice(job, entryPoint);
      return;
    }
    this.createTrackedApplication(job, entryPoint);
  }

  chooseDocumentAction(purpose: EvidencePurpose, choice: DocumentChoice): void {
    if (this.documentChoiceEntryPoint() === 'ADD' && choice === 'GENERATE') return;
    this.documentChoices.update(choices => ({...choices, [purpose]: choice}));
    if (choice !== 'UPLOAD') {
      this.documentChoiceFiles.update(files => ({...files, [purpose]: null}));
    }
    this.refreshDocumentChoiceValidation();
  }

  chooseDocumentFile(purpose: EvidencePurpose, event: Event): void {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    const file = input?.files?.item(0) ?? null;
    this.documentChoiceFiles.update(files => ({...files, [purpose]: file}));
    this.refreshDocumentChoiceValidation();
  }

  closeDocumentChoice(): void {
    this.documentChoiceJob.set(null);
    this.documentChoiceError.set(null);
    this.documentChoices.set({CV: null, COVER_LETTER: null});
    this.documentChoiceFiles.set({CV: null, COVER_LETTER: null});
  }

  continueDocumentChoice(): void {
    const job = this.documentChoiceJob();
    if (!job || !job.applicationId || !this.canContinueDocumentChoice()) {
      this.documentChoiceError.set(
        this.documentChoiceEntryPoint() === 'GENERATE'
          ? 'Choose an action for both documents and select a valid file for each upload.'
          : 'Choose Upload or Not now for both documents and select each upload file.',
      );
      return;
    }
    const jobId = this.jobStateKey(job);
    const choices = this.documentChoices();
    const files = this.documentChoiceFiles();
    const outputs = this.evidencePurposes.filter(purpose => choices[purpose] === 'GENERATE');
    const uploads = new Map<EvidencePurpose, PendingApplicationUpload>();
    for (const purpose of this.evidencePurposes) {
      const file = files[purpose];
      if (choices[purpose] !== 'UPLOAD' || !file) continue;
      uploads.set(purpose, {
        request: {
          applicationId: job.applicationId,
          jobId,
          documentType: purpose,
          file,
          idempotencyKey: `browser-upload-${crypto.randomUUID()}`,
        },
      });
    }
    if (uploads.size) {
      this.pendingApplicationUploads.set(jobId, uploads);
    }
    this.requestedGenerationOutputs.set(outputs);
    this.closeDocumentChoice();
    for (const purpose of uploads.keys()) {
      this.startApplicationUpload(job, purpose);
      break;
    }
    if (outputs.length) {
      this.openEvidenceSelection(job);
    } else if (!uploads.size) {
      this.notify.emit({
        message: 'Application saved. Add documents later.',
        type: 'success',
      });
    }
  }

  retryApplicationUpload(job: Job, purpose: EvidencePurpose): void {
    this.startApplicationUpload(job, purpose);
  }

  chooseReplacementApplicationUpload(job: Job, purpose: EvidencePurpose): void {
    this.clearPendingApplicationUpload(job, purpose);
    this.openDocumentChoice(this.currentJob(this.jobStateKey(job)) ?? job, 'ADD');
    this.chooseDocumentAction(purpose, 'UPLOAD');
  }

  skipApplicationUpload(job: Job, purpose: EvidencePurpose): void {
    this.clearPendingApplicationUpload(job, purpose);
    this.notify.emit({
      message: `${this.documentPurposeLabel(purpose)} upload skipped. Existing documents were not changed.`,
      type: 'info',
    });
  }

  documentPurposeLabel(purpose: EvidencePurpose): string {
    return purpose === 'CV' ? 'CV' : 'Cover letter';
  }

  generationActionLabel(): string {
    const outputs = this.activeEvidencePurposes();
    const names = outputs.map(purpose => this.documentPurposeLabel(purpose));
    const charge = outputs.length === 1
      ? '1 document generation if delivered'
      : `${outputs.length} document generations if both are delivered`;
    return `Generate ${names.join(' and ')} (${charge})`;
  }

  evidenceSelectorDomId(job: Job, suffix: string): string {
    const jobKey = this.jobStateKey(job)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-|-$/g, '') || 'job';
    return `generation-${jobKey}-${suffix}`;
  }

  jobTitle(job: Job): string {
    return job.title ?? job.jobTitle ?? 'Untitled role';
  }

  employerName(job: Job): string {
    return job.companyName ?? job.company ?? 'Employer unavailable';
  }

  generationProviderLabel(job: Job): string {
    const labels = new Set<string>();
    for (const source of job.sources ?? []) {
      const label = source.publisher?.trim()
        || source.integrationProvider?.trim()
        || source.provider?.trim();
      if (label) labels.add(label);
    }
    const fallback = job.primarySource?.trim() || job.provider?.trim();
    if (labels.size === 0 && fallback) labels.add(fallback);
    return Array.from(labels).join(', ') || 'Provider unavailable';
  }

  canonicalJobReference(job: Job): string {
    return job.canonicalJobId ?? job.id ?? 'Reference unavailable';
  }

  confirmEvidenceGeneration(): void {
    const job = this.evidenceSelectionJob();
    if (!job || !this.canGenerateFromSelection()) {
      const confirmationRequired =
        this.generationJobDescriptionNeedsConfirmation()
        && !this.generationJobDescriptionConfirmed();
      this.evidenceSelectionError.set(
        this.generationJobDetailsLoading()
          ? 'Wait for the complete provider advert to finish loading.'
          : confirmationRequired
            ? 'Review and confirm the complete job advert before generating.'
            : `Choose at least one entry confirmed by you for ${this.activeEvidencePurposes()
                .map(purpose => this.documentPurposeLabel(purpose).toLowerCase())
                .join(' and ')}.`,
      );
      return;
    }
    const generationJob: GenerationJob = {
      ...job,
      description: this.generationJobDescription().trim(),
      descriptionCompleteness: this.generationJobDescriptionEdited()
        || job.descriptionCompleteness !== JobDescriptionCompletenessEnum.Full
        ? JobDescriptionCompletenessEnum.UserConfirmed
        : JobDescriptionCompletenessEnum.Full,
      advertiserName: this.generationAdvertiserName().trim(),
      advertiserType: this.generationAdvertiserType() as JobAdvertiserTypeEnum,
      hiringOrganisationName: this.generationHiringOrganisationName().trim() || undefined,
      applicationContactName: this.generationApplicationContactName().trim() || undefined,
    };
    const evidence = {
      cv: {
        entryIds: [...this.cvEvidenceIds()],
        sectionOrder: [...this.cvSectionOrder()],
      },
      coverLetter: {
        entryIds: [...this.coverLetterEvidenceIds()],
        sectionOrder: [...this.coverLetterSectionOrder()],
      },
    };
    this.persistEvidenceDraft();
    this.evidenceRequestSequence++;
    this.jobDetailsRequestSequence++;
    this.evidenceSelectionJob.set(null);
    this.evidenceEntries.set([]);
    this.evidenceLoading.set(false);
    this.evidenceSelectionError.set(null);
    this.evidenceLoadError.set(null);
    this.generationJobDetailsLoading.set(false);
    this.generationJobDetailsError.set(null);
    this.generationJobDescription.set('');
    this.generationJobDescriptionConfirmed.set(false);
    this.generationJobDescriptionEdited.set(false);
    this.resetGenerationJobParties();
    this.generateDocuments(generationJob, evidence, this.activeEvidencePurposes());
  }

  private generateDocuments(
    job: Job,
    evidence: Parameters<DocumentGenerationService['generate']>[1],
    outputs: EvidencePurpose[] = ['CV', 'COVER_LETTER'],
  ): void {
    const jobId = this.jobStateKey(job);
    if (!jobId || this.activeGenerationIds.has(jobId)) return;
    this.generationOutputsByJob.set(jobId, [...outputs]);
    this.markGenerationProcessing(
      jobId,
      outputs.length === 2
        ? 'Generating CV & Cover Letter...'
        : `Generating ${this.documentPurposeLabel(outputs[0] ?? 'CV')}...`,
    );
    this.subscribeToGeneration(
      jobId,
      job,
      () => outputs.length === 2
        ? this.documentGenerationService.generate(job, evidence)
        : this.documentGenerationService.generate(job, evidence, outputs),
    );
  }

  private handleGenerationFailure(jobId: string, error: unknown): void {
    this.finishGeneration(jobId, undefined);
    if (error instanceof DocumentGenerationError) {
      if (error.code === 'CANCELLED') {
        this.generationMessages.update(messages => ({
          ...messages,
          [jobId]: error.message,
        }));
        this.generationErrors.update(errors => ({ ...errors, [jobId]: undefined }));
        this.notify.emit({message: error.message, type: 'info'});
        return;
      }
      this.generationErrors.update(errors => ({ ...errors, [jobId]: error.message }));
      this.notify.emit({message: error.message, type: 'error'});
      return;
    }
    const status = typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as {status?: unknown}).status)
      : undefined;
    const responseError = typeof error === 'object' && error !== null && 'error' in error
      ? (error as {error?: unknown}).error
      : undefined;
    const detail = error instanceof Error
      ? error.message
      : typeof responseError === 'string'
        ? responseError
        : typeof responseError === 'object'
            && responseError !== null
            && 'message' in responseError
            && typeof (responseError as {message?: unknown}).message === 'string'
          ? (responseError as {message: string}).message
          : '';
    const message = detail.includes('Insufficient AI Credit') || detail.includes('Insufficient document generation')
      ? 'There are not enough document generations for this job. No generation request was made.'
      : status === 400 || status === 409
        ? 'One of the selected entries changed or is no longer eligible. Review Experience & achievements and choose again.'
        : 'Generation failed. Please try again.';
    this.generationErrors.update(errors => ({ ...errors, [jobId]: message }));
    this.notify.emit({ message, type: 'error' });
  }

  cancelGeneration(job: Job): void {
    const jobId = this.jobStateKey(job);
    if (
      !jobId
      || !this.generatingJobIds().has(jobId)
      || this.cancellingGenerationIds().has(jobId)
      || this.cancellationSubscriptions.has(jobId)
    ) {
      return;
    }

    this.cancellingGenerationIds.update(ids => new Set(ids).add(jobId));
    this.generationErrors.update(errors => ({...errors, [jobId]: undefined}));
    let settled = false;
    let cancellation: Observable<void>;
    try {
      cancellation = this.documentGenerationService.cancel(jobId);
    } catch (error) {
      this.handleCancellationFailure(jobId, error);
      return;
    }

    const subscription = cancellation.subscribe({
      next: () => {
        if (settled || this.destroyed) return;
        settled = true;
        this.acceptCancellation(jobId);
      },
      error: error => {
        if (settled || this.destroyed) return;
        settled = true;
        this.handleCancellationFailure(jobId, error);
      },
      complete: () => {
        if (settled || this.destroyed) return;
        settled = true;
        this.acceptCancellation(jobId);
      },
    });
    if (!subscription.closed && !settled) {
      this.cancellationSubscriptions.set(jobId, subscription);
    }
  }

  private restorePendingGenerations(jobs: Job[]): void {
    if (
      this.destroyed
      || jobs.length === 0
    ) {
      return;
    }

    const jobsByCanonicalId = new Map(
      jobs
        .map(job => [this.jobStateKey(job), job] as const)
        .filter(([jobId]) => Boolean(jobId)),
    );
    let pendingGenerations: PendingDocumentGeneration[];
    try {
      pendingGenerations = this.documentGenerationService.pendingGenerations();
    } catch {
      return;
    }

    for (const pending of pendingGenerations) {
      const job = jobsByCanonicalId.get(pending.canonicalJobId);
      if (
        !job
        || this.activeGenerationIds.has(pending.canonicalJobId)
        || this.resumedGenerationIds.has(pending.canonicalJobId)
      ) {
        continue;
      }
      this.rememberPendingEvidence(pending);
      this.generationOutputsByJob.set(
        pending.canonicalJobId,
        pending.outputs?.length ? [...pending.outputs] : ['CV', 'COVER_LETTER'],
      );
      this.resumedGenerationIds.add(pending.canonicalJobId);
      this.markGenerationProcessing(
        pending.canonicalJobId,
        'Restoring document generation...',
      );
      this.subscribeToGeneration(
        pending.canonicalJobId,
        job,
        () => this.documentGenerationService.resume(pending.canonicalJobId),
      );
    }
  }

  private rememberPendingEvidence(pending: PendingDocumentGeneration): void {
    if (this.evidenceSelectionDrafts()[pending.canonicalJobId]) return;
    const draft: EvidenceSelectionDraft = {
      cvEvidenceIds: [...pending.evidence.cv.entryIds],
      coverLetterEvidenceIds: [...pending.evidence.coverLetter.entryIds],
      cvSectionOrder: [...pending.evidence.cv.sectionOrder],
      coverLetterSectionOrder: [...pending.evidence.coverLetter.sectionOrder],
    };
    this.evidenceSelectionDrafts.update(drafts => ({
      ...drafts,
      [pending.canonicalJobId]: draft,
    }));
  }

  private markGenerationProcessing(jobId: string, message: string): void {
    this.generatingJobIds.update(ids => new Set(ids).add(jobId));
    this.generationMessages.update(messages => ({...messages, [jobId]: message}));
    this.generationErrors.update(errors => ({...errors, [jobId]: undefined}));
  }

  private subscribeToGeneration(
    jobId: string,
    sourceJob: Job,
    createRequest: () => Observable<DocumentGenerationResponse>,
  ): void {
    if (this.destroyed || this.activeGenerationIds.has(jobId)) return;
    this.activeGenerationIds.add(jobId);

    let generation: Observable<DocumentGenerationResponse>;
    try {
      generation = createRequest();
    } catch (error) {
      this.clearGenerationSubscription(jobId);
      this.handleGenerationFailure(jobId, error);
      return;
    }

    let settled = false;
    const subscription = generation.subscribe({
      next: response => {
        if (settled || this.destroyed) return;
        settled = true;
        this.clearGenerationSubscription(jobId);
        this.acceptGeneration(jobId, sourceJob, response);
      },
      error: error => {
        if (settled || this.destroyed) return;
        settled = true;
        this.clearGenerationSubscription(jobId);
        this.handleGenerationFailure(jobId, error);
      },
      complete: () => {
        if (settled || this.destroyed) return;
        settled = true;
        this.clearGenerationSubscription(jobId);
        if (this.cancellingGenerationIds().has(jobId)) {
          return;
        }
        this.handleGenerationFailure(
          jobId,
          new Error('Document generation completed without an authoritative result.'),
        );
      },
    });
    if (!subscription.closed && !settled) {
      this.generationSubscriptions.set(jobId, subscription);
    }
  }

  private acceptGeneration(
    jobId: string,
    sourceJob: Job,
    response: DocumentGenerationResponse,
  ): void {
    const current = this.currentJob(jobId) ?? sourceJob;
    const outputs = this.generationOutputsByJob.get(jobId) ?? ['CV', 'COVER_LETTER'];
    const generatedOutputs = outputs.filter(output => output === 'CV'
      ? Boolean(response.cvDocumentId)
      : Boolean(response.coverLetterDocumentId));
    const missingOutputs = outputs.filter(output => !generatedOutputs.includes(output));
    const mergedCvDocumentId = response.cvDocumentId ?? current.cvDocumentId;
    const mergedCoverLetterDocumentId = response.coverLetterDocumentId
      ?? current.coverLetterDocumentId;
    const generatedNames = generatedOutputs
      .map(output => this.documentPurposeLabel(output));
    const outcome = generatedNames.join(' and ');
    const partial = missingOutputs.length > 0;
    const recoveryNotices = generatedOutputs.flatMap(output => {
      const summary = response.recovery?.[output];
      if (!summary) return [];
      const label = this.documentPurposeLabel(output);
      if (summary.deterministicFallbackUsed) {
        return [summary.charged
          ? `${label} was delivered with an evidence-based fallback and used one document generation.`
          : `${label} recovery did not deliver a chargeable document, so no document generation was used.`];
      }
      if (summary.reconciliationStatus === 'RECOVERED') {
        return [summary.charged
          ? `${label} recovered safely without a duplicate request.`
          : `${label} recovered safely without a duplicate request or document-generation charge.`];
      }
      if (summary.retried) {
        return [`${label} completed after an automatic provider retry.`];
      }
      if (summary.structuralRepairStatus === 'APPLIED') {
        return [`${label} formatting was repaired automatically.`];
      }
      return [];
    });
    const baseMessage = partial
      ? `${outcome} ready; ${this.documentPurposeLabel(missingOutputs[0] ?? 'CV')} failed. Retry it.`
      : `${outcome} generated successfully.`;
    const message = recoveryNotices.length
      ? `${partial ? baseMessage : `${outcome} ready.`} ${recoveryNotices.join(' ')}`
      : baseMessage;
    this.generationDownloads.update(downloads => ({
      ...downloads,
      [jobId]: response.downloads,
    }));
    this.generatedDocumentIds.update(documentIds => ({
      ...documentIds,
      [jobId]: {
        cvDocumentId: mergedCvDocumentId,
        coverLetterDocumentId: mergedCoverLetterDocumentId,
      },
    }));
    this.updateJobLocally(jobId, {
      applicationId: response.applicationId,
      applicationStatus: mergedCvDocumentId && mergedCoverLetterDocumentId
        ? 'DOCUMENTS_GENERATED'
        : 'SAVED',
      cvDocumentId: mergedCvDocumentId,
      coverLetterDocumentId: mergedCoverLetterDocumentId,
    });
    this.generationOutputsByJob.delete(jobId);
    if (!partial) this.clearEvidenceDraft(jobId);
    this.finishGeneration(jobId, message);
    this.notify.emit({
      message,
      type: partial ? 'info' : 'success',
    });
    this.applicationChanged.emit();
  }

  private acceptCancellation(jobId: string): void {
    this.generationSubscriptions.get(jobId)?.unsubscribe();
    this.clearGenerationSubscription(jobId);
    this.finishGeneration(
      jobId,
      'Generation cancelled. Your evidence selection is ready to edit.',
    );
    this.generationErrors.update(errors => ({...errors, [jobId]: undefined}));
    this.notify.emit({
      message: 'Generation cancelled. Evidence selection kept.',
      type: 'info',
    });
  }

  private handleCancellationFailure(jobId: string, error: unknown): void {
    this.clearCancellationSubscription(jobId);
    const message = error instanceof DocumentGenerationError
      ? error.message
      : 'Cancellation could not be confirmed. Generation is still being reconciled.';
    this.generationErrors.update(errors => ({...errors, [jobId]: message}));
    this.notify.emit({message, type: 'error'});
  }

  private clearGenerationSubscription(jobId: string): void {
    this.activeGenerationIds.delete(jobId);
    this.generationSubscriptions.delete(jobId);
  }

  private clearCancellationSubscription(jobId: string): void {
    this.cancellationSubscriptions.delete(jobId);
    this.cancellingGenerationIds.update(ids => {
      if (!ids.has(jobId)) return ids;
      const next = new Set(ids);
      next.delete(jobId);
      return next;
    });
  }

  private isCurrentEvidenceRequest(jobKey: string, requestSequence: number): boolean {
    const active = this.evidenceSelectionJob();
    return this.evidenceRequestSequence === requestSequence
      && Boolean(active)
      && this.jobStateKey(active as Job) === jobKey;
  }

  private isCurrentJobDetailsRequest(
    jobKey: string,
    requestSequence: number,
  ): boolean {
    const active = this.evidenceSelectionJob();
    return this.jobDetailsRequestSequence === requestSequence
      && Boolean(active)
      && this.jobStateKey(active as Job) === jobKey;
  }

  private restoreEvidenceDraft(jobKey: string): void {
    const draft = this.evidenceSelectionDrafts()[jobKey];
    this.cvEvidenceIds.set([...(draft?.cvEvidenceIds ?? [])]);
    this.coverLetterEvidenceIds.set([...(draft?.coverLetterEvidenceIds ?? [])]);
    this.cvSectionOrder.set([...(draft?.cvSectionOrder ?? [])]);
    this.coverLetterSectionOrder.set([...(draft?.coverLetterSectionOrder ?? [])]);
  }

  private persistEvidenceDraft(): void {
    const job = this.evidenceSelectionJob();
    const jobKey = job ? this.jobStateKey(job) : '';
    if (!jobKey) return;
    if (
      this.cvEvidenceIds().length === 0
      && this.coverLetterEvidenceIds().length === 0
      && this.cvSectionOrder().length === 0
      && this.coverLetterSectionOrder().length === 0
    ) {
      this.clearEvidenceDraft(jobKey);
      return;
    }
    const draft: EvidenceSelectionDraft = {
      cvEvidenceIds: [...this.cvEvidenceIds()],
      coverLetterEvidenceIds: [...this.coverLetterEvidenceIds()],
      cvSectionOrder: [...this.cvSectionOrder()],
      coverLetterSectionOrder: [...this.coverLetterSectionOrder()],
    };
    this.evidenceSelectionDrafts.update(drafts => ({
      ...drafts,
      [jobKey]: draft,
    }));
  }

  private clearEvidenceDraft(jobKey: string): void {
    this.evidenceSelectionDrafts.update(drafts => Object.fromEntries(
      Object.entries(drafts).filter(([key]) => key !== jobKey),
    ));
  }

  private reconcileEvidenceSelection(): void {
    const eligibleById = new Map(this.eligibleEvidence().map(entry => [entry.entryId, entry]));
    const cv = this.reconciledPurpose(
      this.cvEvidenceIds(),
      this.cvSectionOrder(),
      eligibleById,
    );
    const coverLetter = this.reconciledPurpose(
      this.coverLetterEvidenceIds(),
      this.coverLetterSectionOrder(),
      eligibleById,
    );
    this.cvEvidenceIds.set(cv.entryIds);
    this.cvSectionOrder.set(cv.sectionOrder);
    this.coverLetterEvidenceIds.set(coverLetter.entryIds);
    this.coverLetterSectionOrder.set(coverLetter.sectionOrder);
    this.persistEvidenceDraft();
  }

  private reconciledPurpose(
    entryIds: string[],
    sectionOrder: EvidenceSection[],
    eligibleById: Map<string, EvidenceEntry>,
  ): {entryIds: string[]; sectionOrder: EvidenceSection[]} {
    const seenEntryIds = new Set<string>();
    const eligibleIds = entryIds.filter(entryId => {
      if (seenEntryIds.has(entryId) || !eligibleById.has(entryId)) return false;
      seenEntryIds.add(entryId);
      return true;
    });
    const selectedCategories = eligibleIds.map(entryId =>
      eligibleById.get(entryId)?.category as unknown as EvidenceSection);
    const categorySet = new Set(selectedCategories);
    const seenSections = new Set<EvidenceSection>();
    const reconciledOrder = sectionOrder.filter(section => {
      if (seenSections.has(section) || !categorySet.has(section)) return false;
      seenSections.add(section);
      return true;
    });
    for (const category of selectedCategories) {
      if (category && !seenSections.has(category)) {
        reconciledOrder.push(category);
        seenSections.add(category);
      }
    }
    return {entryIds: eligibleIds, sectionOrder: reconciledOrder};
  }

  private validEvidenceSelection(
    entryIds: string[],
    sectionOrder: EvidenceSection[],
  ): boolean {
    if (entryIds.length === 0 || sectionOrder.length === 0) return false;
    const eligibleById = new Map(this.eligibleEvidence().map(entry => [entry.entryId, entry]));
    if (new Set(entryIds).size !== entryIds.length
      || entryIds.some(entryId => !eligibleById.has(entryId))) {
      return false;
    }
    const selectedCategories = new Set(entryIds.map(entryId =>
      eligibleById.get(entryId)?.category as unknown as EvidenceSection));
    return selectedCategories.size === sectionOrder.length
      && new Set(sectionOrder).size === sectionOrder.length
      && sectionOrder.every(section => selectedCategories.has(section));
  }

  private move<T>(values: T[], value: T, direction: -1 | 1): T[] {
    const index = values.indexOf(value);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= values.length) return values;
    const next = [...values];
    [next[index], next[destination]] = [next[destination], next[index]];
    return next;
  }

  trackApplication(job: Job): void {
    this.prepareApplicationDocuments(job, 'ADD');
  }

  private openDocumentChoice(job: Job, entryPoint: DocumentEntryPoint): void {
    this.persistEvidenceDraft();
    this.closeEvidenceSelection();
    this.documentChoiceJob.set(job);
    this.documentChoiceEntryPoint.set(entryPoint);
    this.documentChoices.set({CV: null, COVER_LETTER: null});
    this.documentChoiceFiles.set({CV: null, COVER_LETTER: null});
    this.documentChoiceError.set(null);
  }

  private createTrackedApplication(job: Job, entryPoint: DocumentEntryPoint): void {
    const jobId = this.jobStateKey(job);
    if (!jobId || job.applicationId || this.creatingApplicationIds().has(jobId)) return;
    this.creatingApplicationIds.update(ids => new Set(ids).add(jobId));

    this.applicationTracker.createApplication(job).subscribe({
      next: record => {
        this.applyApplicationRecord(jobId, record);
        this.notify.emit({
          message: 'Application added to My Applications.',
          type: 'success',
        });
        this.applicationChanged.emit();
        this.openDocumentChoice({
          ...job,
          applicationId: record.id,
          applicationStatus: record.status,
          cvDocumentId: record.cvDocumentId,
          coverLetterDocumentId: record.coverLetterDocumentId,
        }, entryPoint);
      },
      error: () => {
        this.creatingApplicationIds.update(ids => {
          const next = new Set(ids);
          next.delete(jobId);
          return next;
        });
        this.notify.emit({
          message: 'Could not add this application. Please try again.',
          type: 'error',
        });
      },
      complete: () => {
        this.creatingApplicationIds.update(ids => {
          const next = new Set(ids);
          next.delete(jobId);
          return next;
        });
      },
    });
  }

  private validApplicationUploadFile(file: File | null): boolean {
    if (!file || file.size < 1 || file.size > 10 * 1024 * 1024) return false;
    const name = file.name.toLowerCase();
    return (name.endsWith('.pdf') && (!file.type || file.type === 'application/pdf'))
      || (name.endsWith('.docx') && (
        !file.type
        || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ));
  }

  private refreshDocumentChoiceValidation(): void {
    const choices = this.documentChoices();
    const files = this.documentChoiceFiles();
    const invalid = this.evidencePurposes.some(purpose =>
      choices[purpose] === 'UPLOAD'
      && files[purpose] !== null
      && !this.validApplicationUploadFile(files[purpose]),
    );
    this.documentChoiceError.set(invalid
      ? 'Choose a non-empty PDF or Microsoft Word .docx file no larger than 10 MiB.'
      : null);
  }

  private startApplicationUpload(job: Job, purpose: EvidencePurpose): void {
    const jobId = this.jobStateKey(job);
    const pending = this.pendingApplicationUploads.get(jobId)?.get(purpose);
    const subscriptionKey = `${jobId}:${purpose}`;
    if (!pending || this.applicationUploadSubscriptions.has(subscriptionKey)) return;
    const updateProgress = (progress: ApplicationDocumentUploadProgress): void => {
      this.setApplicationUploadState(jobId, purpose, {
        phase: progress.phase,
        fileName: pending.request.file.name,
        loadedBytes: progress.loadedBytes,
        totalBytes: progress.totalBytes,
        percent: progress.percent,
        message: progress.phase === 'LINKING'
          ? 'File checked. Linking it to your application…'
          : progress.phase === 'CHECKING'
            ? 'Upload complete. Checking the file…'
            : undefined,
      });
    };
    let operation: Observable<ApplicationDocumentUploadOperationResponse>;
    try {
      operation = this.documentGenerationService.uploadApplicationDocument(
        pending.request,
        updateProgress,
      );
    } catch (error) {
      this.rejectApplicationUpload(jobId, purpose, pending.request.file.name, error);
      return;
    }
    const subscription = operation.pipe(finalize(() => {
      this.applicationUploadSubscriptions.delete(subscriptionKey);
      const next = this.evidencePurposes.find(candidate =>
        this.pendingApplicationUploads.get(jobId)?.has(candidate)
        && this.applicationUploadState(job, candidate)?.phase !== 'ERROR');
      if (next) this.startApplicationUpload(job, next);
    })).subscribe({
      next: result => {
        if (result.state !== 'COMPLETED' || !result.documentId) {
          this.rejectApplicationUpload(
            jobId,
            purpose,
            pending.request.file.name,
            result.failureMessage || 'The file could not be linked safely. Retry it or skip this document.',
            result.state === 'RECOVERY_REQUIRED',
          );
          return;
        }
        const current = this.currentJob(jobId) ?? job;
        const patch = purpose === 'CV'
          ? {cvDocumentId: result.documentId}
          : {coverLetterDocumentId: result.documentId};
        this.updateJobLocally(jobId, patch);
        this.generatedDocumentIds.update(documentIds => ({
          ...documentIds,
          [jobId]: {
            cvDocumentId: purpose === 'CV'
              ? result.documentId
              : documentIds[jobId]?.cvDocumentId ?? current.cvDocumentId,
            coverLetterDocumentId: purpose === 'COVER_LETTER'
              ? result.documentId
              : documentIds[jobId]?.coverLetterDocumentId ?? current.coverLetterDocumentId,
          },
        }));
        this.pendingApplicationUploads.get(jobId)?.delete(purpose);
        this.setApplicationUploadState(jobId, purpose, {
          phase: 'COMPLETED',
          fileName: pending.request.file.name,
          percent: 100,
          message: `${this.documentPurposeLabel(purpose)} uploaded and linked.`,
        });
        this.notify.emit({
          message: `${this.documentPurposeLabel(purpose)} uploaded successfully.`,
          type: 'success',
        });
        this.applicationChanged.emit();
      },
      error: error => this.rejectApplicationUpload(
        jobId,
        purpose,
        pending.request.file.name,
        error,
      ),
    });
    if (!subscription.closed) {
      this.applicationUploadSubscriptions.set(subscriptionKey, subscription);
    }
  }

  private rejectApplicationUpload(
    jobId: string,
    purpose: EvidencePurpose,
    fileName: string,
    error: unknown,
    canRetry = true,
  ): void {
    const message = typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : 'The upload did not complete. Retry it or skip this document.';
    this.setApplicationUploadState(jobId, purpose, {
      phase: 'ERROR',
      fileName,
      message,
      canRetry,
    });
    this.notify.emit({message, type: 'error'});
  }

  private clearPendingApplicationUpload(job: Job, purpose: EvidencePurpose): void {
    const jobId = this.jobStateKey(job);
    const pending = this.pendingApplicationUploads.get(jobId);
    pending?.delete(purpose);
    if (pending?.size === 0) this.pendingApplicationUploads.delete(jobId);
    this.applicationUploadSubscriptions.get(`${jobId}:${purpose}`)?.unsubscribe();
    this.applicationUploadSubscriptions.delete(`${jobId}:${purpose}`);
    this.applicationUploadStates.update(states => {
      const jobStates = {...states[jobId]};
      delete jobStates[purpose];
      return {...states, [jobId]: jobStates};
    });
  }

  private setApplicationUploadState(
    jobId: string,
    purpose: EvidencePurpose,
    state: ApplicationUploadViewState,
  ): void {
    this.applicationUploadStates.update(states => ({
      ...states,
      [jobId]: {...states[jobId], [purpose]: state},
    }));
  }

  updateApplicationStatus(job: Job, status: StatusUpdateTarget): void {
    const jobId = this.jobStateKey(job);
    if (!jobId || !job.applicationId || this.updatingApplicationStatuses()[jobId]) {
      if (!job.applicationId) {
        this.notify.emit({
          message: 'Generate documents before updating status.',
          type: 'error',
        });
      }
      return;
    }

    this.updatingApplicationStatuses.update(updating => ({ ...updating, [jobId]: status }));
    this.applicationTracker.updateStatus(
      job.applicationId,
      status,
      job.applicationVersion,
    ).pipe(
      finalize(() => {
        this.updatingApplicationStatuses.update(updating => ({
          ...updating,
          [jobId]: undefined,
        }));
      }),
    ).subscribe({
      next: (record) => {
        this.applyApplicationRecord(jobId, record);
        const updatedStatus = record.status ?? status;
        this.notify.emit({
          message: updatedStatus === 'APPLIED'
            ? 'Marked as applied. Documents are locked.'
            : `Application status updated to ${updatedStatus.toLowerCase().replaceAll('_', ' ')}.`,
          type: 'success',
        });
        this.applicationChanged.emit();
      },
      error: () => {
        this.notify.emit({
          message: 'Status update failed. Please try again.',
          type: 'error',
        });
      },
    });
  }

  withdrawGeneratedApplication(job: Job): void {
    const jobId = this.jobStateKey(job);
    if (!jobId || !job.applicationId || this.updatingApplicationStatuses()[jobId]) {
      if (!job.applicationId) {
        this.notify.emit({
          message: 'Generate documents before withdrawing.',
          type: 'error',
        });
      }
      return;
    }

    this.updatingApplicationStatuses.update(updating => ({ ...updating, [jobId]: 'WITHDRAWN' }));
    this.applicationTracker.withdrawGeneratedApplication(job.applicationId).pipe(
      finalize(() => {
        this.updatingApplicationStatuses.update(updating => ({
          ...updating,
          [jobId]: undefined,
        }));
      }),
    ).subscribe({
      next: outcome => {
        if (outcome.processing || outcome.withdrawn !== true) {
          const message = outcome.retryable
            ? 'Withdrawal was not completed. Your application and documents have been retained; try again.'
            : (
                outcome.message
                || 'Withdrawal needs recovery. Your application and documents have been retained.'
              );
          this.generationMessages.update(messages => ({
            ...messages,
            [jobId]: message,
          }));
          this.notify.emit({message, type: 'info'});
          this.applicationChanged.emit();
          return;
        }
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
          message: 'Application withdrawn and reset to new.',
          type: 'success',
        });
        this.applicationChanged.emit();
      },
      error: () => {
        this.notify.emit({
          message: 'Withdrawal failed. Please try again.',
          type: 'error',
        });
      },
    });
  }

  uploadReplacement(job: Job, request: DocumentUploadRequest): void {
    const jobId = this.jobStateKey(job);
    if (!jobId || this.uploadingDocuments()[jobId]) return;

    this.uploadingDocuments.update(uploading => ({ ...uploading, [jobId]: request.documentKind }));
    this.documentGenerationService.uploadReplacement(
      request.applicationId,
      request.file,
      request.documentKind
    ).then((response) => {
      if (response.processing) {
        const message = response.retryable
          ? `${request.documentKind === 'CV' ? 'CV' : 'Cover letter'} replacement was not completed. Your current documents have been retained; try again.`
          : (
              response.message
              || `${request.documentKind === 'CV' ? 'CV' : 'Cover letter'} replacement needs recovery. Your current documents have been retained.`
            );
        this.notify.emit({message, type: 'info'});
        this.applicationChanged.emit();
        return;
      }
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
    }).finally(() => {
      this.uploadingDocuments.update(uploading => ({ ...uploading, [jobId]: undefined }));
    });
  }

  downloadFile(file: DownloadFileResponse): void {
    this.documentGenerationService.download(file).catch(() => {
      this.notify.emit({ message: 'Download failed. Please try again.', type: 'error' });
    });
  }

  dismissGenerationError(jobId: string): void {
    this.generationErrors.update(errors => ({ ...errors, [jobId]: undefined }));
  }

  private finishGeneration(jobId: string, message: string | undefined): void {
    this.cancellationSubscriptions.get(jobId)?.unsubscribe();
    this.clearCancellationSubscription(jobId);
    this.generatingJobIds.update(ids => {
      const next = new Set(ids);
      next.delete(jobId);
      return next;
    });
    this.generationMessages.update(messages => ({ ...messages, [jobId]: message }));
  }

  applyApplicationRecord(jobId: string, record: ApplicationRecordResponse): void {
    if (!jobId) return;
    const displayedJob = this.jobs().find(job =>
      this.jobStateKey(job) === record.canonicalJobId
      || (record.jobTitle === job.title && record.companyName === job.company));
    const displayedJobId = displayedJob ? this.jobStateKey(displayedJob) : jobId;
    this.persistedApplicationsByJobId.set(record.canonicalJobId ?? jobId, record);
    if (record.provider && record.externalJobId) {
      this.persistedApplicationsByJobId.set(
        `${record.provider}:${record.externalJobId}`,
        record,
      );
    }
    if (record.provider && record.jobTitle && record.companyName) {
      this.persistedApplicationsByJobId.set(
        `${record.provider}:${record.jobTitle}:${record.companyName}`.toLowerCase(),
        record,
      );
    }
    this.updateJobLocally(displayedJobId, {
      applicationId: record.id,
      applicationVersion: record.version,
      applicationStatus: record.status,
      cvDocumentId: record.cvDocumentId,
      coverLetterDocumentId: record.coverLetterDocumentId,
      appliedAt: record.appliedAt,
      applicationUpdatedAt: record.updatedAt,
    });
    this.generatedDocumentIds.update(documentIds => ({
      ...documentIds,
      [displayedJobId]: {
        cvDocumentId: record.cvDocumentId,
        coverLetterDocumentId: record.coverLetterDocumentId,
      },
    }));
  }

  private reconcilePersistedApplication(job: Job): Job {
    const provider = job.primarySource ?? job.provider;
    const record = this.persistedApplicationsByJobId.get(this.jobStateKey(job))
      ?? this.persistedApplicationsByJobId.get(
        provider && job.externalJobId ? `${provider}:${job.externalJobId}` : '',
      )
      ?? this.persistedApplicationsByJobId.get(
        provider ? `${provider}:${job.title}:${job.company}`.toLowerCase() : '',
      );
    if (!record) return job;
    return {
      ...job,
      applicationId: record.id,
      applicationVersion: record.version,
      applicationStatus: record.status,
      cvDocumentId: record.cvDocumentId,
      coverLetterDocumentId: record.coverLetterDocumentId,
      appliedAt: record.appliedAt,
      applicationUpdatedAt: record.updatedAt,
    };
  }

  private updateJobLocally(jobId: string, patch: Partial<Job>): void {
    this.localApplicationMutationSequence.set(jobId, this.searchRequestSequence);
    const applyPatch = (job: Job): Job =>
      this.jobStateKey(job) === jobId ? { ...job, ...patch } : job;
    this.roleStates.update(states => Object.fromEntries(
      Object.entries(states).map(([key, state]) => [
        key,
        {
          ...state,
          pages: Object.fromEntries(
            Object.entries(state.pages).map(([page, cached]) => [
              page,
              {
                ...cached,
                jobs: cached.jobs.map(applyPatch),
              },
            ]),
          ),
        },
      ]),
    ));
  }

  private preserveNewerLocalApplicationState(
    job: Job,
    requestSequence: number,
  ): Job {
    const jobId = this.jobStateKey(job);
    const mutationSequence = this.localApplicationMutationSequence.get(jobId);
    if (mutationSequence == null || mutationSequence < requestSequence) {
      return job;
    }
    const current = this.currentJob(jobId);
    if (!current) return job;
    return {
      ...job,
      applicationId: current.applicationId,
      applicationVersion: current.applicationVersion,
      applicationStatus: current.applicationStatus,
      cvDocumentId: current.cvDocumentId,
      coverLetterDocumentId: current.coverLetterDocumentId,
      appliedAt: current.appliedAt,
      applicationUpdatedAt: current.applicationUpdatedAt,
    };
  }

  private reconcileGeneratedState(jobs: Job[]): void {
    const visibleGeneratedJobIds = new Set(
      jobs
        .filter(job => this.jobStateKey(job) && this.hasPersistedGeneratedDocuments(job))
        .map(job => this.jobStateKey(job))
    );

    this.generationDownloads.update(downloads => this.keepKeys(downloads, visibleGeneratedJobIds));
    this.generatedDocumentIds.update(documentIds => this.keepKeys(documentIds, visibleGeneratedJobIds));
    this.generationMessages.update(messages => this.keepKeys(messages, visibleGeneratedJobIds));
    this.generationErrors.update(errors =>
      this.keepKeys(errors, new Set(jobs.map(job => this.jobStateKey(job)).filter(Boolean))));
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
    return this.jobs().find(job => this.jobStateKey(job) === jobId);
  }

  private rehydrateGeneratedDownloads(jobs: Job[]): void {
    for (const job of jobs) {
      const jobId = this.jobStateKey(job);
      if (!jobId || !this.hasPersistedGeneratedDocuments(job)) continue;
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
        error: () => undefined,
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
        error: () => undefined,
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
    if (value.includes('nhs jobs') || providerValue === 'NHS_JOBS') return 'NHS Jobs';
    if (value.includes('find an apprenticeship') || providerValue === 'APPRENTICESHIPS') return 'Find an apprenticeship';
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
