import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Job } from '../../models/job-search.model';
import { UpdateApplicationStatusRequest } from '../../api/job-finder';
import {
  DownloadFileResponse,
  GenerationDownloadsResponse,
} from '../../api/document-generation-gateway';

type UploadDocumentKind = 'CV' | 'COVER_LETTER';
type ApplicationStatus = NonNullable<Job['applicationStatus']>;
type StatusUpdateTarget = UpdateApplicationStatusRequest['status'];

interface StatusAction {
  label: string;
  icon: string;
  status: StatusUpdateTarget;
  confirmation?: string;
  variant?: 'primary' | 'secondary' | 'danger';
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

  job = input.required<Job>();
  generating = input(false);
  generationMessage = input<string | null>(null);
  generationError = input<string | null>(null);
  downloads = input<GenerationDownloadsResponse | null>(null);
  cvDocumentId = input<string | null>(null);
  coverLetterDocumentId = input<string | null>(null);
  uploadingDocument = input<UploadDocumentKind | null>(null);
  updatingStatus = input<StatusUpdateTarget | null>(null);
  generateDocuments = output<Job>();
  updateApplicationStatus = output<StatusUpdateTarget>();
  downloadFile = output<DownloadFileResponse>();
  uploadReplacement = output<DocumentUploadRequest>();
  dismissGenerationError = output<string>();
  withdrawGeneratedApplication = output<boolean>();

  expanded = signal(false);
  statusMenuOpen = signal(false);
  uploadModalKind = signal<UploadDocumentKind | null>(null);
  selectedFile = signal<File | null>(null);
  uploadError = signal<string | null>(null);

  demoFocusId(): string {
    const job = this.job();
    return `job-card-${this.slug(job.id ?? job.applicationId ?? `${job.title ?? 'role'}-${job.company ?? 'company'}`)}`;
  }

  demoFocusGroup(): string {
    const job = this.job();
    return `job-card-${this.slug(job.applicationId ?? job.id ?? `${job.title ?? 'role'}-${job.company ?? 'company'}`)}`;
  }

  statusMenuId(): string {
    return `${this.demoFocusGroup()}-status-menu`;
  }

  toggle(): void {
    this.statusMenuOpen.set(false);
    this.expanded.update(v => !v);
  }

  toggleStatusMenu(event: MouseEvent): void {
    event.stopPropagation();
    if (this.statusActions().length === 0 || this.updatingStatus()) return;
    this.statusMenuOpen.update(open => !open);
  }

  requestGeneration(): void {
    this.generateDocuments.emit(this.job());
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
    const jobId = this.job().id;
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
    if (this.generating()) return 'DOCUMENTS_GENERATED';
    return 'NEW';
  }

  statusActions(): StatusAction[] {
    switch (this.statusLabel() as ApplicationStatus) {
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
    const url = this.job().url;
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

  primaryApplyUrl(): string | undefined {
    const direct = (this.job().sources ?? []).find(source => source.directApply && source.applyUrl);
    return direct?.applyUrl ?? this.job().url;
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
}
