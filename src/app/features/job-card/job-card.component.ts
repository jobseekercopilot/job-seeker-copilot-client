import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Job } from '../../models/job-search.model';
import { UpdateApplicationStatusRequest } from '../../api/job-finder';
import { DownloadFileResponse } from '../../api/document-generation-gateway';
import { GenerationDownloadsResponse } from '../../services/document-generation.service';
import {approvedExternalUrl} from '../../../shared/provider-content-policy';

type UploadDocumentKind = 'CV' | 'COVER_LETTER';
type ApplicationStatus = NonNullable<Job['applicationStatus']>;
type StatusUpdateTarget = `${UpdateApplicationStatusRequest['status']}`;

interface StatusAction {
  label: string;
  icon: string;
  status: StatusUpdateTarget;
  confirmation?: string;
  variant?: 'primary' | 'secondary' | 'danger';
}

interface CommuteAssessmentView {
  status?: string;
  workplaceType?: string;
  bestSuitableMode?: string;
  explanationCode?: string;
  modes?: Array<{mode?: string; durationMinutes?: number; outcome?: string}>;
}

export interface DocumentUploadRequest {
  applicationId: string;
  documentKind: UploadDocumentKind;
  file: File;
}

@Component({
  selector: 'app-job-card',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  host: {
    'data-demo-focus': 'app-job-card',
    '[attr.data-demo-focus-id]': 'demoFocusId()',
    '[attr.data-demo-focus-group]': 'demoFocusGroup()',
    'data-demo-focus-overlay-owner': 'true'
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './job-card.component.html',
  styleUrl: './job-card.component.css'
})
export class JobCardComponent {
  private static readonly MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
  private static readonly DESCRIPTION_PREVIEW_LENGTH = 450;

  job = input.required<Job>();
  generating = input(false);
  cancellingGeneration = input(false);
  generationMessage = input<string | null>(null);
  generationError = input<string | null>(null);
  downloads = input<GenerationDownloadsResponse | null>(null);
  cvDocumentId = input<string | null>(null);
  coverLetterDocumentId = input<string | null>(null);
  uploadingDocument = input<UploadDocumentKind | null>(null);
  updatingStatus = input<StatusUpdateTarget | null>(null);
  creatingApplication = input(false);
  applicationTrackingAvailable = input(false);
  applicationToolsAvailable = input(false);
  generationPanelActive = input(false);
  descriptionLoading = input(false);
  descriptionLoadError = input<string | null>(null);
  trackApplication = output<Job>();
  generateDocuments = output<Job>();
  cancelGeneration = output<Job>();
  updateApplicationStatus = output<StatusUpdateTarget>();
  downloadFile = output<DownloadFileResponse>();
  uploadReplacement = output<DocumentUploadRequest>();
  dismissGenerationError = output<string>();
  withdrawGeneratedApplication = output<boolean>();
  requestFullDescription = output<Job>();

  expanded = signal(false);
  descriptionExpanded = signal(false);
  statusMenuOpen = signal(false);
  uploadModalKind = signal<UploadDocumentKind | null>(null);
  selectedFile = signal<File | null>(null);
  uploadError = signal<string | null>(null);

  demoFocusId(): string {
    const job = this.job();
    return `job-card-${this.slug(job.canonicalJobId ?? job.id ?? job.applicationId ?? `${job.title ?? 'role'}-${job.company ?? 'company'}`)}`;
  }

  demoFocusGroup(): string {
    const job = this.job();
    return `job-card-${this.slug(job.applicationId ?? job.canonicalJobId ?? job.id ?? `${job.title ?? 'role'}-${job.company ?? 'company'}`)}`;
  }

  statusMenuId(): string {
    return `${this.demoFocusGroup()}-status-menu`;
  }

  detailsId(): string {
    return `${this.demoFocusId()}-details`;
  }

  commuteSummary(): string | null {
    const assessment = (this.job() as Job & {commuteAssessment?: CommuteAssessmentView})
      .commuteAssessment;
    if (!assessment) return null;
    if (assessment.status === 'NOT_APPLICABLE') return 'Remote — no commute';
    if (assessment.status === 'UNAVAILABLE') return 'Commute estimate unavailable';
    if (assessment.status === 'NOT_EVALUATED') return null;
    const preferred = assessment.modes?.find(mode =>
      mode.mode === assessment.bestSuitableMode) ?? assessment.modes?.[0];
    if (preferred?.durationMinutes == null) return null;
    const label = preferred.mode === 'TRANSIT' ? 'public transport' : 'driving';
    const suitability = assessment.status === 'WITHIN_PREFERENCE'
      ? 'within preference' : 'above preference';
    return `About ${preferred.durationMinutes} min by ${label} · ${suitability}`;
  }

  googleMapsCommuteAttributionRequired(): boolean {
    return (this.job() as Job & {commuteAssessment?: CommuteAssessmentView})
      .commuteAssessment?.providerAttribution === 'GOOGLE_MAPS';
  }

  descriptionId(): string {
    return `${this.demoFocusId()}-description`;
  }

  detailsExpanded(): boolean {
    return this.expanded() || this.generationPanelActive();
  }

  toggle(): void {
    if (this.generationPanelActive()) return;
    this.statusMenuOpen.set(false);
    this.expanded.update(v => !v);
  }

  toggleStatusMenu(event: MouseEvent): void {
    event.stopPropagation();
    if (!this.applicationTrackingAvailable() || this.statusActions().length === 0 || this.updatingStatus()) return;
    this.statusMenuOpen.update(open => !open);
  }

  requestGeneration(): void {
    if (!this.applicationToolsAvailable()) return;
    this.expanded.set(true);
    this.generateDocuments.emit(this.job());
  }

  requestCancelGeneration(): void {
    if (!this.generating() || this.cancellingGeneration()) return;
    this.cancelGeneration.emit(this.job());
  }

  fullDescription(): string {
    const description = this.job().description?.replace(/\r\n?/g, '\n').trim();
    return description || 'No description available.';
  }

  hasExpandableDescription(): boolean {
    return this.fullDescription().length > JobCardComponent.DESCRIPTION_PREVIEW_LENGTH;
  }

  visibleDescription(): string {
    const description = this.fullDescription();
    if (this.descriptionExpanded() || !this.hasExpandableDescription()) {
      return description;
    }

    const limit = JobCardComponent.DESCRIPTION_PREVIEW_LENGTH;
    const candidate = description.slice(0, limit + 1);
    const whitespaceBoundary = Math.max(
      candidate.lastIndexOf(' '),
      candidate.lastIndexOf('\n'),
      candidate.lastIndexOf('\t'),
    );
    const cutoff = whitespaceBoundary >= Math.floor(limit * 0.75)
      ? whitespaceBoundary
      : limit;
    return `${description.slice(0, cutoff).trimEnd()}…`;
  }

  toggleDescription(): void {
    if (!this.hasExpandableDescription()) return;
    this.descriptionExpanded.update(expanded => !expanded);
  }

  canLoadFullDescription(): boolean {
    const job = this.job();
    return job.descriptionCompleteness !== 'FULL'
      && Boolean(job.externalJobId?.trim())
      && Boolean(job.primarySource?.trim() || job.provider?.trim());
  }

  requestDescriptionAction(): void {
    if (this.descriptionLoading()) return;
    if (this.canLoadFullDescription()) {
      this.descriptionExpanded.set(true);
      this.requestFullDescription.emit(this.job());
      return;
    }
    this.toggleDescription();
  }

  descriptionActionLabel(): string {
    if (this.descriptionLoading()) return 'Loading full advert…';
    if (this.canLoadFullDescription()) {
      return this.descriptionLoadError() ? 'Retry full advert' : 'Read full advert';
    }
    return this.descriptionExpanded() ? 'Show less' : 'Read more';
  }

  requestTrackApplication(): void {
    if (!this.applicationTrackingAvailable() || this.creatingApplication()) return;
    this.trackApplication.emit(this.job());
  }

  requestStatusUpdate(action: StatusAction): void {
    if (this.updatingStatus()) return;
    if (action.confirmation && !window.confirm(action.confirmation)) return;
    this.statusMenuOpen.set(false);
    if (this.statusLabel() === 'DOCUMENTS_GENERATED' && action.status === 'WITHDRAWN') {
      this.withdrawGeneratedApplication.emit(true);
      return;
    }
    this.updateApplicationStatus.emit(action.status);
  }

  requestDownload(file: DownloadFileResponse | undefined): void {
    if (file) {
      this.downloadFile.emit(file);
    }
  }

  openUpload(kind: UploadDocumentKind): void {
    if (!this.canUploadDocuments()) return;
    this.uploadModalKind.set(kind);
    this.selectedFile.set(null);
    this.uploadError.set(null);
  }

  closeUpload(): void {
    if (this.uploadingDocument()) return;
    this.uploadModalKind.set(null);
    this.selectedFile.set(null);
    this.uploadError.set(null);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.setSelectedFile(input.files?.[0] ?? null);
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.setSelectedFile(event.dataTransfer?.files?.[0] ?? null);
  }

  submitUpload(): void {
    if (!this.canUploadDocuments()) {
      this.uploadError.set('Documents cannot be replaced after the application has been marked as applied.');
      return;
    }
    const documentKind = this.uploadModalKind();
    const applicationId = this.job().applicationId;
    const file = this.selectedFile();
    if (!documentKind || !applicationId || !file) {
      this.uploadError.set('Choose a DOCX file first.');
      return;
    }
    this.uploadReplacement.emit({ applicationId, documentKind, file });
  }

  uploadTitle(): string {
    return this.uploadModalKind() === 'CV' ? 'Upload New CV' : 'Upload New Cover Letter';
  }

  replacementName(): string {
    return this.uploadModalKind() === 'CV' ? 'CV' : 'cover letter';
  }

  dismissError(): void {
    const job = this.job();
    const jobId = job.canonicalJobId ?? job.id;
    if (jobId) {
      this.dismissGenerationError.emit(jobId);
    }
  }

  formatSalary(salary: { min?: number; max?: number; currency?: string } | undefined | null): string {
    if (!salary || typeof salary.min !== 'number' || typeof salary.max !== 'number') {
      return 'Salary not specified';
    }
    return `${salary.currency ?? 'GBP'} ${salary.min.toLocaleString()} - ${salary.max.toLocaleString()}`;
  }

  formatDate(dateString: string | undefined | null): string {
    if (!dateString) return 'date unavailable';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'date unavailable';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  formatDistance(distanceMiles: number | undefined | null): string | null {
    if (distanceMiles == null || Number.isNaN(distanceMiles)) {
      return null;
    }
    return `${distanceMiles.toFixed(1)} miles from you`;
  }

  statusLabel(): string {
    const applicationStatus = this.job().applicationStatus;
    if (applicationStatus) return applicationStatus;
    if (this.downloads()) return 'DOCUMENTS_GENERATED';
    return 'NEW';
  }

  statusDisplayLabel(): string {
    switch (this.statusLabel()) {
      case 'NEW':
        return 'Not saved';
      case 'SAVED':
        return 'Saved to applications';
      case 'DOCUMENTS_GENERATED':
        return 'Documents prepared';
      case 'APPLIED':
        return 'Applied';
      case 'INTERVIEW':
        return 'Interview';
      case 'OFFER':
        return 'Offer';
      case 'UNSUCCESSFUL':
        return 'Unsuccessful';
      case 'ACCEPTED':
        return 'Accepted';
      case 'REJECTED_BY_USER':
        return 'Offer declined';
      case 'WITHDRAWN':
        return 'Withdrawn';
      default:
        return 'Application status unavailable';
    }
  }

  statusActions(): StatusAction[] {
    switch (this.statusLabel() as ApplicationStatus) {
      case 'SAVED':
        return [
          { label: 'Mark as Applied', icon: 'send', status: 'APPLIED', variant: 'primary' },
        ];
      case 'DOCUMENTS_GENERATED':
        return [
          { label: 'Mark as Applied', icon: 'send', status: 'APPLIED', variant: 'primary' },
          {
            label: 'Withdraw',
            icon: 'block',
            status: 'WITHDRAWN',
            confirmation: 'Withdraw this generated application? This will remove the generated CV and cover letter and reset the job to New.',
            variant: 'secondary',
          },
        ];
      case 'APPLIED':
        return [
          { label: 'Mark Interview', icon: 'event_available', status: 'INTERVIEW', variant: 'primary' },
          {
            label: 'Mark Unsuccessful',
            icon: 'cancel',
            status: 'UNSUCCESSFUL',
            confirmation: 'Mark this application as unsuccessful?',
            variant: 'danger',
          },
        ];
      case 'INTERVIEW':
        return [
          { label: 'Mark Offer', icon: 'celebration', status: 'OFFER', variant: 'primary' },
          {
            label: 'Mark Unsuccessful',
            icon: 'cancel',
            status: 'UNSUCCESSFUL',
            confirmation: 'Mark this application as unsuccessful?',
            variant: 'danger',
          },
        ];
      case 'OFFER':
        return [
          {
            label: 'Mark Accepted',
            icon: 'check_circle',
            status: 'ACCEPTED',
            confirmation: 'Mark this offer as accepted?',
            variant: 'primary',
          },
          {
            label: 'Decline Offer',
            icon: 'do_not_disturb_on',
            status: 'REJECTED_BY_USER',
            confirmation: 'Decline this offer?',
            variant: 'secondary',
          },
        ];
      default:
        return [];
    }
  }

  readonlyStatusLabel(): string | null {
    switch (this.statusLabel() as ApplicationStatus) {
      case 'ACCEPTED':
        return 'Accepted';
      case 'UNSUCCESSFUL':
        return 'Unsuccessful';
      case 'WITHDRAWN':
        return 'Withdrawn';
      case 'REJECTED_BY_USER':
        return 'Offer declined';
      default:
        return null;
    }
  }

  canUploadDocuments(): boolean {
    return this.statusLabel() === 'DOCUMENTS_GENERATED';
  }

  documentsLocked(): boolean {
    return [
      'APPLIED',
      'INTERVIEW',
      'OFFER',
      'ACCEPTED',
      'UNSUCCESSFUL',
      'REJECTED_BY_USER',
      'WITHDRAWN',
    ].includes(this.statusLabel());
  }

  statusClass(): string {
    return `status-${this.statusLabel().toLowerCase().replaceAll('_', '-')}`;
  }

  statusActionClass(action: StatusAction): string {
    return action.variant === 'danger'
      ? 'dashboard-button-danger'
      : action.variant === 'secondary'
        ? 'dashboard-button-secondary'
        : 'dashboard-button-primary';
  }

  statusActionLabel(action: StatusAction): string {
    return this.updatingStatus() === action.status ? 'Updating...' : action.label;
  }

  sourceLabel(): string {
    const publishers = this.sourceLabels();
    if (publishers.length > 0) return publishers[0];
    const url = this.primaryApplyUrl();
    if (!url) return 'Job source';
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return 'Job source';
    }
  }

  sourceLabels(): string[] {
    const labels = new Set<string>();
    for (const source of this.job().sources ?? []) {
      if (source.publisher?.trim()) {
        labels.add(source.publisher.trim());
      }
    }
    return Array.from(labels);
  }

  primaryApplyUrl(): string | null {
    const direct = (this.job().sources ?? [])
      .find(source => source.directApply && approvedExternalUrl(source.applyUrl));
    return approvedExternalUrl(direct?.applyUrl)
      ?? approvedExternalUrl(this.job().url)
      ?? approvedExternalUrl(this.job().sourceUrl)
      ?? this.safeSourceLinks()[0]?.url
      ?? null;
  }

  safeSourceLinks(): {label: string; url: string}[] {
    const links = new Map<string, string>();
    for (const source of this.job().sources ?? []) {
      const label = source.publisher?.trim() || source.integrationProvider?.trim() || 'Job source';
      for (const candidate of [source.applyUrl, source.listingUrl]) {
        const url = approvedExternalUrl(candidate);
        if (url && !links.has(url)) links.set(url, label);
      }
    }
    for (const candidate of [this.job().sourceUrl, this.job().url]) {
      const url = approvedExternalUrl(candidate);
      if (url && !links.has(url)) links.set(url, this.sourceLabelForUrl(url));
    }
    return Array.from(links, ([url, label]) => ({label, url}));
  }

  private setSelectedFile(file: File | null): void {
    if (!file) {
      this.selectedFile.set(null);
      return;
    }
    const lowerName = file.name.toLowerCase();
    const allowedMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (!lowerName.endsWith('.docx') || (file.type && file.type !== allowedMimeType)) {
      this.uploadError.set('Please upload a Microsoft Word .docx file.');
      this.selectedFile.set(null);
      return;
    }
    if (file.size > JobCardComponent.MAX_UPLOAD_BYTES) {
      this.uploadError.set('File size must be 25MB or less.');
      this.selectedFile.set(null);
      return;
    }
    this.uploadError.set(null);
    this.selectedFile.set(file);
  }

  private slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
  }

  private sourceLabelForUrl(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return 'Job source';
    }
  }
}
