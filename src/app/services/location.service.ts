import { inject, Injectable } from '@angular/core';
import {catchError, map, Observable, of, startWith} from 'rxjs';
import {
  Location as UKLocation,
  LocationResponse as LocationGatewayResponse,
  LocationService as GeneratedLocationService
} from '../api/location';

export type { UKLocation, LocationGatewayResponse };

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
  locations: UKLocation[];
  message: string;
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

  search(query: string): Observable<LocationGatewayResponse> {
    return this.locationApi.searchLocations(query);
  }

  getByPostcode(postcode: string): Observable<LocationGatewayResponse> {
    return this.locationApi.getLocationByPostcode(postcode);
  }

  lookup(query: string): Observable<LocationLookupState> {
    const cleanQuery = (query || '').trim();
    if (cleanQuery.length < 2) return of(idleLocationLookup);

    const isPostcodeOrOutcode = /^[A-Z]{1,2}[0-9]/i.test(cleanQuery);
    const request = isPostcodeOrOutcode
      ? this.getByPostcode(cleanQuery)
      : this.search(cleanQuery);

    return request.pipe(
      map(response => {
        if (!response.success) return failureState(response.statusCode);

        const locations = response.locations ?? [];
        return locations.length > 0
          ? {
              status: 'results' as const,
              locations,
              message: `${locations.length} matching ${locations.length === 1 ? 'location' : 'locations'} found.`,
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
