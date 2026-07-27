import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import {
  ApplicationRecordResponse,
  JobSearchRequest,
  ReedJobSearchResponse,
  JobSearchService as GeneratedJobSearchService,
  UpdateApplicationStatusRequest
} from '../api/job-finder';
import { LocationService } from './location.service';
import { BrowserSessionService } from './browser-session.service';

export interface WithdrawGeneratedApplicationResponse {
  applicationId?: string;
  status?: 'NEW';
  withdrawn?: boolean;
  message?: string;
}

@Injectable({
  providedIn: 'root'
})
export class JobService {
  private jobSearchApi = inject(GeneratedJobSearchService);
  private http = inject(HttpClient);
  private locationService = inject(LocationService);
  private browserSession = inject(BrowserSessionService);

  /**
   * Calls POST /api/jobs/search with the claimant profile as a JSON body.
   * The job-finder-gateway orchestrates the backend search and returns aligned results.
   *
   * @param skills     - Claimant's skills summary (unused in search, but passed for context)
   * @param experience - Claimant's work experience (unused in search, but passed for context)
   * @param aspirations - Claimant's career aspirations (comma-separated roles)
   * @param workPrefs   - Claimant's work preferences (JSON string)
   */
  searchJobs(
    skills: string,
    experience: string,
    aspirations: string,
    workPrefs: string
  ): Observable<ReedJobSearchResponse> {
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
    let homeDisplayName: string | undefined;
    let homePostcode: string | undefined;
    let homeLatitude: number | undefined;
    let homeLongitude: number | undefined;
    try {
      const prefs = JSON.parse(workPrefs);
      if (prefs.postcode) {
        homePostcode = String(prefs.postcode).trim().toUpperCase();
      }
      if (prefs.region) {
        homeDisplayName = String(prefs.region).trim();
        const primaryRegion = homeDisplayName.split(',', 1)[0]?.trim();
        if (primaryRegion) {
          locations.push(primaryRegion);
        }
      }
      if (homePostcode) {
        locations.push(homePostcode);
      }
      if (typeof prefs.latitude === 'number') {
        homeLatitude = prefs.latitude;
      }
      if (typeof prefs.longitude === 'number') {
        homeLongitude = prefs.longitude;
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
        culture: [],
        homeLatitude,
        homeLongitude
      },
      homeLocation: {
        displayName: homeDisplayName,
        postcode: homePostcode,
        latitude: homeLatitude,
        longitude: homeLongitude
      }
    };

    return this.browserSession.ensureCsrf().pipe(
      switchMap(() => this.resolveHomeLocation(body)),
      switchMap(searchBody => this.jobSearchApi.searchJobs(
        searchBody,
        'body',
        false,
        { transferCache: false }
      ))
    );
  }

  private resolveHomeLocation(body: JobSearchRequest): Observable<JobSearchRequest> {
    const homeLocation = body.homeLocation;
    if ((homeLocation?.latitude != null && homeLocation?.longitude != null) || !homeLocation?.postcode) {
      return of(body);
    }

    return this.locationService.getByPostcode(homeLocation.postcode).pipe(
      map(response => {
        const resolved = response.locations?.[0];
        if (!resolved || resolved.latitude == null || resolved.longitude == null) {
          return body;
        }
        return {
          ...body,
          workPreferences: {
            ...body.workPreferences,
            homeLatitude: resolved.latitude,
            homeLongitude: resolved.longitude
          },
          homeLocation: {
            displayName: resolved.name ?? homeLocation.displayName,
            postcode: resolved.postcode ?? homeLocation.postcode,
            latitude: resolved.latitude,
            longitude: resolved.longitude
          }
        };
      }),
      catchError(() => of(body))
    );
  }

  updateApplicationStatus(
    applicationId: string,
    status: string,
    token: string,
    userId: string
  ): Observable<ApplicationRecordResponse> {
    return this.http.patch<ApplicationRecordResponse>(
      `/api/jobs/applications/${encodeURIComponent(applicationId)}/status`,
      { status: status as UpdateApplicationStatusRequest['status'] },
      { headers: this.applicationActionHeaders(token, userId) }
    );
  }

  withdrawGeneratedApplication(
    applicationId: string,
    token: string,
    userId: string
  ): Observable<WithdrawGeneratedApplicationResponse> {
    return this.http.post<WithdrawGeneratedApplicationResponse>(
      `/api/jobs/applications/${encodeURIComponent(applicationId)}/withdraw-generated`,
      {},
      { headers: this.applicationActionHeaders(token, userId) }
    );
  }

  private applicationActionHeaders(token: string, userId: string): HttpHeaders {
    let headers = new HttpHeaders();
    if (token) {
      headers = headers.set('Authorization', token.startsWith('Bearer ') ? token : `Bearer ${token}`);
    }
    if (userId) {
      headers = headers.set('X-User-Id', userId);
    }
    return headers;
  }
}
