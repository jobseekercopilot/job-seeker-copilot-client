import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  Location as UKLocation,
  LocationResponse as LocationGatewayResponse,
  LocationService as GeneratedLocationService
} from '../api/location';

export type { UKLocation, LocationGatewayResponse };

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
}
