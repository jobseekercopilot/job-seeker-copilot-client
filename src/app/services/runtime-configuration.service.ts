import {HttpClient} from '@angular/common/http';
import {inject, Injectable} from '@angular/core';
import {Observable} from 'rxjs';

export type JobSearchProviderMode =
  | 'FIXTURE'
  | 'REAL_PROVIDERS'
  | 'REQUIRED_VALIDATION';

interface JobSearchModeResponse {
  mode: JobSearchProviderMode;
}

export type DocumentGenerationMode =
  | 'FIXTURE_LLM'
  | 'REQUIRED_VALIDATION';

interface DocumentGenerationModeResponse {
  mode: DocumentGenerationMode;
}

@Injectable({providedIn: 'root'})
export class RuntimeConfigurationService {
  private readonly http = inject(HttpClient);

  jobSearchMode(): Observable<JobSearchModeResponse> {
    return this.http.get<JobSearchModeResponse>(
      '/api/runtime/job-search-mode',
      {withCredentials: true},
    );
  }

  documentGenerationMode(): Observable<DocumentGenerationModeResponse> {
    return this.http.get<DocumentGenerationModeResponse>(
      '/api/runtime/document-generation-mode',
      {withCredentials: true},
    );
  }
}
