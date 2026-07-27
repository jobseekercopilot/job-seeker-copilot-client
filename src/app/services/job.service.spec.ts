import {TestBed} from '@angular/core/testing';
import {of} from 'rxjs';
import {
  JobSearchService as GeneratedJobSearchService,
  type JobSearchRequest,
} from '../api/job-finder';
import {BrowserSessionService} from './browser-session.service';
import {JobService} from './job.service';
import {LocationService} from './location.service';

describe('JobService', () => {
  it('bootstraps CSRF and sends only the canonical request body', () => {
    const searchJobs = vi.fn((request: JobSearchRequest) => {
      void request;
      return of({jobs: [], totalResults: 0});
    });
    const ensureCsrf = vi.fn(() => of(undefined));
    TestBed.configureTestingModule({
      providers: [
        JobService,
        {provide: GeneratedJobSearchService, useValue: {searchJobs}},
        {provide: BrowserSessionService, useValue: {ensureCsrf}},
        {provide: LocationService, useValue: {getByPostcode: vi.fn()}},
      ],
    });

    let response: unknown;
    TestBed.inject(JobService)
      .searchJobs('TypeScript', '', 'Frontend developer', '{}')
      .subscribe(value => response = value);

    expect(ensureCsrf).toHaveBeenCalledOnce();
    expect(searchJobs).toHaveBeenCalledOnce();
    expect(searchJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        aspirations: expect.objectContaining({desiredRoles: ['Frontend developer']}),
      }),
      'body',
      false,
      {transferCache: false},
    );
    expect(response).toEqual({jobs: [], totalResults: 0});
  });
});
