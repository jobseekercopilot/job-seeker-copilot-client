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

  it('uses the searchable town before the postcode while retaining secure home coordinates', () => {
    const searchJobs = vi.fn((request: JobSearchRequest) => {
      void request;
      return of({jobs: [], totalResults: 0});
    });
    const getByPostcode = vi.fn(() => of({
      locations: [{
        name: 'Reading, South East',
        postcode: 'RG1 1AA',
        latitude: 51.4543,
        longitude: -0.9781,
      }],
    }));
    TestBed.configureTestingModule({
      providers: [
        JobService,
        {provide: GeneratedJobSearchService, useValue: {searchJobs}},
        {provide: BrowserSessionService, useValue: {ensureCsrf: vi.fn(() => of(undefined))}},
        {provide: LocationService, useValue: {getByPostcode}},
      ],
    });

    TestBed.inject(JobService)
      .searchJobs(
        'Java',
        '',
        'Software Developer',
        JSON.stringify({postcode: 'RG1 1AA', region: 'Reading, South East'}),
      )
      .subscribe();

    expect(searchJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        aspirations: expect.objectContaining({
          locations: ['Reading', 'RG1 1AA'],
          salaryExpectation: {currency: 'GBP'},
        }),
        homeLocation: expect.objectContaining({
          postcode: 'RG1 1AA',
          latitude: 51.4543,
          longitude: -0.9781,
        }),
      }),
      'body',
      false,
      {transferCache: false},
    );
  });
});
