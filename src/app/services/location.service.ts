import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface UKLocation {
  id: string;
  name: string;
  postcode: string;
  region: string;
}

export interface LocationGatewayResponse {
  statusCode: number;
  success: boolean;
  message: string;
  locations: UKLocation[];
}

@Injectable({
  providedIn: 'root'
})
export class LocationService {
  private apiUrl = '/api';

  constructor(private http: HttpClient) {}

  search(query: string): Observable<LocationGatewayResponse> {
    return this.http.get<LocationGatewayResponse>(`${this.apiUrl}/locations?q=${encodeURIComponent(query)}`);
  }

  getByPostcode(postcode: string): Observable<LocationGatewayResponse> {
    return this.http.get<LocationGatewayResponse>(`${this.apiUrl}/postcodes/${encodeURIComponent(postcode)}`);
  }
}