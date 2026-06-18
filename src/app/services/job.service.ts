import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { JobSearchRequest, JobSearchResponse } from '../models/job-search.model';

@Injectable({
  providedIn: 'root'
})
export class JobService {
  private http = inject(HttpClient);
  private baseUrl = '/api/jobs';

  /**
   * Calls POST /api/jobs/search with the claimant profile as a JSON body.
   * The job-finder-gateway orchestrates the backend search and returns aligned results.
   *
   * @param skills     - Claimant's skills summary (unused in search, but passed for context)
   * @param experience - Claimant's work experience (unused in search, but passed for context)
   * @param aspirations - Claimant's career aspirations (comma-separated roles)
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
    // Parse aspirations into desired roles
    const desiredRoles = aspirations
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    // Parse workPrefs JSON string into work preferences
    let employmentType: string[] = ['FULL_TIME'];
    let remotePreference: 'REMOTE' | 'HYBRID' | 'ONSITE' = 'HYBRID';
    try {
      const prefs = JSON.parse(workPrefs);
      const hours = (prefs.hours || '').toLowerCase();
      if (hours.includes('full')) {
        employmentType = ['FULL_TIME'];
      } else if (hours.includes('part')) {
        employmentType = ['PART_TIME'];
      }
      if (prefs.remotePreference) {
        remotePreference = prefs.remotePreference;
      }
    } catch {
      // Use defaults if parsing fails
    }

    // Default location from work prefs postcode or use a broad search
    const locations: string[] = [];
    try {
      const prefs = JSON.parse(workPrefs);
      if (prefs.postcode) {
        locations.push(prefs.postcode);
      }
      if (prefs.region) {
        locations.push(prefs.region);
      }
    } catch {
      // Fallback
    }
    if (locations.length === 0) {
      locations.push('United Kingdom');
    }

    const body: JobSearchRequest = {
      aspirations: {
        desiredRoles,
        industries: [],
        salaryExpectation: {
          min: 0,
          max: 0,
          currency: 'GBP'
        },
        locations
      },
      workPreferences: {
        employmentType,
        remotePreference,
        companySize: [],
        culture: []
      }
    };

    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    });

    return this.http.post<JobSearchResponse>(`${this.baseUrl}/search`, body, {
      headers
    });
  }
}