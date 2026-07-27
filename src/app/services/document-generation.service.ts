import { Injectable } from '@angular/core';
import { from, Observable } from 'rxjs';
import { Job } from '../models/job-search.model';
import {
  Configuration,
  DocumentDownloadsResponse,
  DocumentGenerationResponse,
  DocumentGenerationControllerApi,
  DownloadFileResponse,
  Job as GenerationJob,
} from '../api/document-generation-gateway';

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
  private readonly api = new DocumentGenerationControllerApi(
    new Configuration({ basePath: '' })
  );

  generate(job: Job, token: string, userId: string): Observable<DocumentGenerationResponse> {
    if (!job.id || !job.title || !job.company || !job.description) {
      throw new Error('The selected job does not contain the data required for generation.');
    }

    return from(this.api.generate({
      jobId: job.id,
      xUserId: userId || undefined,
      documentGenerationRequest: { job: job as GenerationJob },
    }, async ({ init }) => ({
      headers: {
        ...init.headers,
        ...this.authorizationHeader(token),
      },
    })));
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

  async deleteGeneratedDocument(generatedDocumentId: string, token: string): Promise<void> {
    if (!generatedDocumentId) {
      throw new Error('Generated document id is missing.');
    }

    const response = await fetch(`/api/v1/documents/${encodeURIComponent(generatedDocumentId)}`, {
      method: 'DELETE',
      headers: this.authorizationHeader(token),
    });

    if (!response.ok) {
      throw new Error(await this.errorMessage(response, 'Delete failed.'));
    }
  }

  async withdrawGeneratedApplication(applicationId: string, token: string, userId: string): Promise<void> {
    if (!applicationId) {
      throw new Error('Application id is missing.');
    }

    const response = await fetch(`/api/jobs/applications/${encodeURIComponent(applicationId)}/withdraw-generated`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authorizationHeader(token),
        ...(userId ? { 'X-User-Id': userId } : {}),
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new Error(await this.errorMessage(response, 'Delete failed.'));
    }
  }

  async download(file: DownloadFileResponse, token: string): Promise<void> {
    if (!file.fileId) {
      throw new Error('Download file id is missing.');
    }

    const requestOptions = await this.api.downloadRequestOpts({ fileId: file.fileId });
    const response = await fetch(requestOptions.path, {
      method: requestOptions.method,
      headers: {
        ...requestOptions.headers,
        ...this.authorizationHeader(token),
      },
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
    documentKind: DocumentKind,
    token: string,
    userId: string
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

    const response = await fetch(`/api/v1/document-generation/applications/${encodeURIComponent(applicationId)}/replace`, {
      method: 'POST',
      headers: {
        ...this.authorizationHeader(token),
        ...(userId ? { 'X-User-Id': userId } : {}),
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(await this.errorMessage(response, 'Upload failed.'));
    }

    return response.json();
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

  private authorizationHeader(token: string): Record<string, string> {
    const trimmed = token.trim();
    if (!trimmed) return {};
    return { Authorization: trimmed.startsWith('Bearer ') ? trimmed : `Bearer ${trimmed}` };
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
