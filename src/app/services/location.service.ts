import { inject, Injectable } from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {catchError, map, Observable, of, startWith} from 'rxjs';
import {
  Location as UKLocation,
  LocationResponse as LocationGatewayResponse,
  LocationService as GeneratedLocationService
} from '../api/location';

export type { UKLocation, LocationGatewayResponse };

export interface LocationOption extends UKLocation {
  sessionId?: string;
  suggestionId?: string;
  primaryText?: string;
  secondaryText?: string;
  precisionHint?: string;
}

export interface CanonicalLocation {
  locationId: string;
  displayName?: string;
  countryCode?: string;
  postcode?: string;
  locality?: string;
  region?: string;
  latitude?: number;
  longitude?: number;
  locationType?: string;
  precision?: string;
  confidence?: string;
  providerReferences?: Array<{provider: string; externalId: string}>;
  fieldProvenance?: Array<{field: string; source: string}>;
}

interface AutocompleteResponse {
  sessionId: string;
  suggestions?: Array<{
    suggestionId: string;
    primaryText: string;
    secondaryText?: string;
    precisionHint?: string;
  }>;
  attribution?: {required: boolean; provider?: string};
}

export interface ResolveResponse {
  location?: CanonicalLocation;
  resolutionStatus: 'RESOLVED' | 'CONFIRMATION_REQUIRED';
  attribution?: {required: boolean; provider?: string};
  reasonCode?: string;
}

export type LocationLookupStatus =
  | 'idle'
  | 'loading'
  | 'results'
  | 'empty'
  | 'invalid'
  | 'rate-limited'
  | 'unavailable';

export interface LocationLookupState {
  status: LocationLookupStatus;
  locations: LocationOption[];
  message: string;
  attributionProvider?: string;
}

export const idleLocationLookup: LocationLookupState = {
  status: 'idle',
  locations: [],
  message: '',
};

function failureState(statusCode: number | undefined): LocationLookupState {
  if (statusCode === 400) {
    return {
      status: 'invalid',
      locations: [],
      message: 'Enter a valid UK location or postcode.',
    };
  }

  if (statusCode === 404) {
    return {
      status: 'empty',
      locations: [],
      message: 'No matching locations found.',
    };
  }

  if (statusCode === 429) {
    return {
      status: 'rate-limited',
      locations: [],
      message: 'Too many location searches. Try again shortly.',
    };
  }

  return {
    status: 'unavailable',
    locations: [],
    message: 'Location search is temporarily unavailable. Try again.',
  };
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  const status = Number(error.status);
  return Number.isInteger(status) ? status : undefined;
}

@Injectable({
  providedIn: 'root'
})
export class LocationService {
  private locationApi = inject(GeneratedLocationService);
  private http = inject(HttpClient);

  search(query: string): Observable<LocationGatewayResponse> {
    return this.locationApi.searchLocations(query);
  }

  getByPostcode(postcode: string): Observable<LocationGatewayResponse> {
    return this.locationApi.getLocationByPostcode(postcode);
  }

  autocomplete(input: string, sessionId?: string): Observable<AutocompleteResponse> {
    return this.http.post<AutocompleteResponse>('/api/v2/locations/autocomplete', {
      input,
      ...(sessionId ? {sessionId} : {}),
      countryCodes: ['GB'],
    });
  }

  resolve(sessionId: string, suggestionId: string): Observable<ResolveResponse> {
    return this.http.post<ResolveResponse>('/api/v2/locations/resolve', {sessionId, suggestionId});
  }

  lookup(query: string): Observable<LocationLookupState> {
    const cleanQuery = (query || '').trim();
    if (cleanQuery.length < 3) return of(idleLocationLookup);

    return this.autocomplete(cleanQuery).pipe(
      map(response => {
        const locations: LocationOption[] = (response.suggestions ?? []).map(suggestion => ({
          id: suggestion.suggestionId,
          name: [suggestion.primaryText, suggestion.secondaryText].filter(Boolean).join(', '),
          postcode: '',
          region: suggestion.secondaryText ?? '',
          sessionId: response.sessionId,
          suggestionId: suggestion.suggestionId,
          primaryText: suggestion.primaryText,
          secondaryText: suggestion.secondaryText,
          precisionHint: suggestion.precisionHint,
        }));
        return locations.length > 0
          ? {
              status: 'results' as const,
              locations,
              message: `${locations.length} matching ${locations.length === 1 ? 'location' : 'locations'} found.`,
              ...(response.attribution?.required
                ? {attributionProvider: response.attribution.provider ?? 'GOOGLE_MAPS'}
                : {}),
            }
          : {
              status: 'empty' as const,
              locations: [],
              message: 'No matching locations found.',
            };
      }),
      catchError(error => of(failureState(errorStatus(error)))),
      startWith({
        status: 'loading' as const,
        locations: [],
        message: 'Searching locations…',
      }),
    );
  }
}
