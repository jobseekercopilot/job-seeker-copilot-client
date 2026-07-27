import {inject, Injectable} from '@angular/core';
import {Observable} from 'rxjs';
import {
  ApplicationRecordResponse,
  JobSearchRequest,
  ReedJobSearchResponse,
  JobSearchService,
  UpdateApplicationStatusRequest
} from '../api/job-finder';

@Injectable({
  providedIn: 'root'
})
export class JobFinderGatewayService {
  private api = inject(JobSearchService);

  searchJobs(request: JobSearchRequest): Observable<ReedJobSearchResponse> {
    return this.api.searchJobs(request, 'body', false, {transferCache: false});
  }

  updateApplicationStatus(
    applicationId: string,
    status: UpdateApplicationStatusRequest['status'],
    _userId?: string
  ): Observable<ApplicationRecordResponse> {
    return this.api.updateApplicationStatus(applicationId, {status});
  }
}
