import {Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {JobSearchRequest, JobSearchResponse} from '../models/job-search.model';

@Injectable({
  providedIn: 'root'
})
export class JobFinderGatewayService {
  private baseUrl = '/api/jobs';

  constructor(private http: HttpClient) {}

  searchJobs(request: JobSearchRequest): Observable<JobSearchResponse> {
    return this.http.post<JobSearchResponse>(`${this.baseUrl}/search`, request);
  }
}