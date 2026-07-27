import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, from, map, Observable, switchMap } from 'rxjs';
import { Job } from '../models/job-search.model';
import {
  DocumentDownloadsResponse,
  DocumentGenerationResponse,
  DocumentGenerationControllerService,
  DownloadFileResponse,
  GenerationOperationResponse,
} from '../api/document-generation-gateway';
import {
  Job as SavedJob,
  SavedJobsService,
} from '../api/job-finder';
import { BrowserSessionService } from './browser-session.service';

export type DocumentKind = 'CV' | 'COVER_LETTER';
export type UploadFormat = 'DOCX' | 'PDF';

export interface DocumentUploadResponse {
  generatedDocumentId: string;
  applicationId?: string;
  cvDocumentId?: string;
  coverLetterDocumentId?: string;
  version?: number;
  uploadedFile?: DownloadFileResponse;
  regeneratedFiles?: DownloadFileResponse[];
  latestFiles?: DocumentDownloadsResponse;
  message?: string;
}

export interface DocumentFileMetadata {
  id?: string;
  generatedDocumentId?: string;
  fileType?: 'DOCX' | 'PDF';
  fileName?: string;
  mimeType?: string;
  source?: 'SYSTEM_GENERATED' | 'USER_UPLOADED' | string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
  sizeBytes?: number;
  fileSize?: number;
}

@Injectable({ providedIn: 'root' })
export class DocumentGenerationService {
  private readonly api = inject(DocumentGenerationControllerService);
  private readonly savedJobs = inject(SavedJobsService);
  private readonly browserSession = inject(BrowserSessionService);
  private readonly http = inject(HttpClient);

  generate(job: Job): Observable<DocumentGenerationResponse> {
    if (!job.id || !job.title || !job.company || !job.description) {
      throw new Error('The selected job does not contain the data required for generation.');
    }

    const idempotencyKey = `browser-${crypto.randomUUID()}`;
    return this.browserSession.ensureCsrf().pipe(
      switchMap(() => this.savedJobs.save(
        job as SavedJob,
        'body',
        false,
        {transferCache: false},
      )),
      switchMap(savedJob => {
        if (!savedJob.savedJobId) {
          throw new Error('The selected job could not be saved for document generation.');
        }
        return this.api.startOperation(
          savedJob.savedJobId,
          idempotencyKey,
          'body',
          false,
          {transferCache: false},
        );
      }),
      switchMap(operation => {
        if (
          operation.state !== 'AWAITING_APPROVAL'
          || !operation.operationId
          || !operation.cvDocumentId
          || !operation.coverLetterDocumentId
        ) {
          throw new Error(this.operationFailure(operation));
        }
        return this.api.approveOperation(
          operation.operationId,
          {
            cvDocumentId: operation.cvDocumentId,
            coverLetterDocumentId: operation.coverLetterDocumentId,
          },
          'body',
          false,
          {transferCache: false},
        );
      }),
      map(operation => this.completedGeneration(operation)),
    );
  }

  latestFiles(generatedDocumentId: string): Observable<DocumentDownloadsResponse> {
    if (!generatedDocumentId) {
      throw new Error('Generated document id is missing.');
    }

    return from(
      fetch(`/api/v1/document-generation/documents/${encodeURIComponent(generatedDocumentId)}/files/latest`)
        .then(async response => {
          if (!response.ok) {
            throw new Error(await this.errorMessage(response, 'Could not load generated document files.'));
          }
          return response.json() as Promise<DocumentDownloadsResponse>;
        })
    );
  }

  latestFileMetadata(generatedDocumentId: string): Observable<DocumentFileMetadata[]> {
    if (!generatedDocumentId) {
      throw new Error('Generated document id is missing.');
    }

    return from(
      fetch(`/api/v1/documents/${encodeURIComponent(generatedDocumentId)}/files/latest`)
        .then(async response => {
          if (!response.ok) {
            throw new Error(await this.errorMessage(response, 'Could not load generated document file metadata.'));
          }
          return response.json() as Promise<DocumentFileMetadata[]>;
        })
    );
  }

  allFileMetadata(generatedDocumentId: string): Observable<DocumentFileMetadata[]> {
    if (!generatedDocumentId) {
      throw new Error('Generated document id is missing.');
    }

    return from(
      fetch(`/api/v1/documents/${encodeURIComponent(generatedDocumentId)}/files`)
        .then(async response => {
          if (!response.ok) {
            throw new Error(await this.errorMessage(response, 'Could not load generated document file metadata.'));
          }
          return response.json() as Promise<DocumentFileMetadata[]>;
        })
    );
  }

  async deleteGeneratedDocument(generatedDocumentId: string): Promise<void> {
    if (!generatedDocumentId) {
      throw new Error('Generated document id is missing.');
    }

    await firstValueFrom(this.browserSession.ensureCsrf().pipe(
      switchMap(() => this.http.delete<void>(
        `/api/v1/documents/${encodeURIComponent(generatedDocumentId)}`,
      )),
    ));
  }

  async withdrawGeneratedApplication(applicationId: string): Promise<void> {
    if (!applicationId) {
      throw new Error('Application id is missing.');
    }

    await firstValueFrom(this.browserSession.ensureCsrf().pipe(
      switchMap(() => this.http.post<void>(
        `/api/jobs/applications/${encodeURIComponent(applicationId)}/withdraw-generated`,
        {},
      )),
    ));
  }

  async download(file: DownloadFileResponse): Promise<void> {
    if (!file.fileId) {
      throw new Error('Download file id is missing.');
    }

    const response = await fetch(`/api/v1/document-generation/files/${encodeURIComponent(file.fileId)}/download`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}.`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = this.fileNameFromDisposition(response.headers.get('content-disposition')) || file.fileName || 'document';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async uploadReplacement(
    applicationId: string,
    file: File,
    documentKind: DocumentKind
  ): Promise<DocumentUploadResponse> {
    if (!applicationId) {
      throw new Error('Application id is missing.');
    }
    if (!this.isDocx(file)) {
      throw new Error('Please upload a Microsoft Word .docx file.');
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('documentType', documentKind);

    return firstValueFrom(this.browserSession.ensureCsrf().pipe(
      switchMap(() => this.http.post<DocumentUploadResponse>(
        `/api/v1/document-generation/applications/${encodeURIComponent(applicationId)}/replace`,
        formData,
      )),
    ));
  }

  isDocx(file: File): boolean {
    const hasDocxExtension = file.name.toLowerCase().endsWith('.docx');
    const mimeType = file.type;
    const hasAllowedMimeType = !mimeType
      || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return hasDocxExtension && hasAllowedMimeType;
  }

  private fileNameFromDisposition(disposition: string | null): string | null {
    if (!disposition) return null;
    const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1].replace(/"/g, ''));
    const asciiMatch = /filename="?([^";]+)"?/i.exec(disposition);
    return asciiMatch?.[1] ?? null;
  }

  private completedGeneration(operation: GenerationOperationResponse): DocumentGenerationResponse {
    if (
      operation.state !== 'COMPLETED'
      || !operation.applicationId
      || !operation.cvDocumentId
      || !operation.coverLetterDocumentId
    ) {
      throw new Error(this.operationFailure(operation));
    }
    return {
      applicationId: operation.applicationId,
      cvDocumentId: operation.cvDocumentId,
      coverLetterDocumentId: operation.coverLetterDocumentId,
      downloads: {
        cv: this.exportDownloads(operation.downloads?.['cv']),
        coverLetter: this.exportDownloads(operation.downloads?.['coverLetter']),
      },
    };
  }

  private exportDownloads(value: object | undefined): DocumentDownloadsResponse {
    const exports = value && 'exports' in value
      ? (value as {exports?: unknown}).exports
      : undefined;
    if (!Array.isArray(exports)) return {};

    const downloads: DocumentDownloadsResponse = {};
    for (const item of exports) {
      if (!item || typeof item !== 'object') continue;
      const exported = item as {
        fileId?: unknown;
        fileName?: unknown;
        format?: unknown;
      };
      if (typeof exported.fileId !== 'string') continue;
      const file: DownloadFileResponse = {
        fileId: exported.fileId,
        fileName: typeof exported.fileName === 'string' ? exported.fileName : undefined,
        downloadUrl: `/api/v1/document-generation/files/${encodeURIComponent(exported.fileId)}/download`,
      };
      if (exported.format === 'DOCX') downloads.docx = file;
      if (exported.format === 'PDF') downloads.pdf = file;
    }
    return downloads;
  }

  private operationFailure(operation: GenerationOperationResponse): string {
    if (operation.failureMessage) return operation.failureMessage;
    if (operation.failureCode) return `Document generation failed (${operation.failureCode}).`;
    return `Document generation did not complete safely (state: ${operation.state ?? 'unknown'}).`;
  }

  private async errorMessage(response: Response, fallback: string): Promise<string> {
    const fallbackWithStatus = `${fallback} Status ${response.status}.`;
    const contentType = response.headers.get('content-type') ?? '';
    try {
      if (contentType.includes('application/json')) {
        const body = await response.json();
        return body.message || body.error || fallbackWithStatus;
      }
      const text = await response.text();
      return text || fallbackWithStatus;
    } catch {
      return fallbackWithStatus;
    }
  }
}
