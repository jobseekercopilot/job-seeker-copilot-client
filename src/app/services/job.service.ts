import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import {
  JobSearchRequest,
  ReedJobSearchResponse,
  JobSearchService as GeneratedJobSearchService
} from '../api/job-finder';
import { LocationService } from './location.service';
import { BrowserSessionService } from './browser-session.service';

const SEARCH_EMPLOYMENT_TYPES = new Set([
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'TEMPORARY',
]);

export interface JobSearchOptions {
  targetRole?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}

@Injectable({
  providedIn: 'root'
})
export class JobService {
  private jobSearchApi = inject(GeneratedJobSearchService);
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
    workPrefs: string,
    options: JobSearchOptions = {},
  ): Observable<ReedJobSearchResponse> {
    // Parse aspirations into desired roles
    const profileRoles = aspirations
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    const targetRole = options.targetRole?.trim();
    const desiredRoles = targetRole ? [targetRole] : profileRoles;

    // Parse workPrefs JSON string into work preferences
    let employmentType: string[] = [];
    let remotePreference: string | undefined;
    try {
      const prefs = JSON.parse(workPrefs);
      const profileEmploymentTypes = Array.isArray(prefs.employmentTypes)
        ? prefs.employmentTypes
        : [];
      const profileWorkingPatterns = Array.isArray(prefs.workingPatterns)
        ? prefs.workingPatterns
        : [];
      employmentType = Array.from(new Set(
        [...profileEmploymentTypes, ...profileWorkingPatterns]
          .filter((value: unknown): value is string =>
            typeof value === 'string' && SEARCH_EMPLOYMENT_TYPES.has(value)),
      ));
      const workplaceArrangements = Array.isArray(prefs.workplaceArrangements)
        ? prefs.workplaceArrangements
        : [];
      remotePreference = workplaceArrangements.find((value: unknown): value is string =>
        typeof value === 'string' && ['REMOTE', 'HYBRID', 'ONSITE'].includes(value));
    } catch {
      // Omit preferences that the user has not supplied.
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
      }
      const adminDistrict = prefs.adminDistrict
        ? String(prefs.adminDistrict).trim()
        : '';
      const searchableLocation = adminDistrict || homeDisplayName?.split(',', 1)[0]?.trim();
      if (searchableLocation) {
        locations.push(searchableLocation);
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
    const body: JobSearchRequest = {
      aspirations: {
        desiredRoles,
        industries: [],
        salaryExpectation: {
          currency: 'GBP'
        },
        locations
      },
      workPreferences: {
        ...(employmentType.length ? {employmentType} : {}),
        ...(remotePreference ? {remotePreference} : {}),
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
      },
      ...(options.page != null ? {page: options.page} : {}),
      ...(options.pageSize != null ? {pageSize: options.pageSize} : {}),
      ...(options.sort
        ? {sort: options.sort as JobSearchRequest['sort']}
        : {}),
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

}
