import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { JobSearchResponse } from '../models/job-search.model';

@Injectable({
  providedIn: 'root'
})
export class JobService {
  private http = inject(HttpClient);
  private baseUrl = '/api/jobs';

  /**
   * Calls GET /api/jobs/search with the claimant profile as query parameters.
   * The job-finder-gateway orchestrates the backend search and returns aligned results.
   *
   * @param skills    - Claimant's skills summary
   * @param experience - Claimant's work experience
   * @param aspirations - Claimant's career aspirations
   * @param workPrefs   - Claimant's work preferences (JSON string)
   * @param token       - JWT Bearer token for authorization
   */
  searchJobs(
    skills: string,
    experience: string,
    aspirations: string,
    workPrefs: string,
    token: string
  ): Observable<JobSearchResponse> {
    const params: Record<string, string> = {
      skills,
      experience,
      aspirations,
      workPrefs
    };

    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    });

    return this.http.get<JobSearchResponse>(`${this.baseUrl}/search`, {
      headers,
      params
    });
  }
}