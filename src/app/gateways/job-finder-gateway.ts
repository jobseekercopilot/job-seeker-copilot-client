import {inject, Injectable} from '@angular/core';
import {Observable} from 'rxjs';
import {
  ApplicationRecordResponse,
  JobSearchRequest,
  JobSearchResponse,
  JobSearchService,
  UpdateApplicationStatusRequest
} from '../api/job-finder';

@Injectable({
  providedIn: 'root'
})
export class JobFinderGatewayService {
  private api = inject(JobSearchService);

  searchJobs(request: JobSearchRequest, userId?: string): Observable<JobSearchResponse> {
    return this.api.searchJobs(userId, request);
  }

  updateApplicationStatus(
    applicationId: string,
    status: UpdateApplicationStatusRequest['status'],
    userId?: string
  ): Observable<ApplicationRecordResponse> {
    return this.api.updateApplicationStatus(applicationId, userId, { status });
  }
}
