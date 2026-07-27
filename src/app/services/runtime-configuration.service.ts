import {HttpClient} from '@angular/common/http';
import {inject, Injectable} from '@angular/core';
import {Observable} from 'rxjs';

export type JobSearchProviderMode =
  | 'FIXTURE'
  | 'REAL'
  | 'REQUIRED_VALIDATION';

interface JobSearchModeResponse {
  mode: JobSearchProviderMode;
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
}
