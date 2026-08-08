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
  it('loads one selected provider job without caching the advert', () => {
    const getJobDetails = vi.fn(() => of({
      externalJobId: 'reed-42',
      description: 'Complete provider advert',
      descriptionCompleteness: 'FULL',
    }));
    TestBed.configureTestingModule({
      providers: [
        JobService,
        {provide: GeneratedJobSearchService, useValue: {getJobDetails}},
        {provide: BrowserSessionService, useValue: {ensureCsrf: vi.fn()}},
        {provide: LocationService, useValue: {getByPostcode: vi.fn()}},
      ],
    });

    TestBed.inject(JobService)
      .getJobDetails('REED', 'reed-42')
      .subscribe();

    expect(getJobDetails).toHaveBeenCalledWith(
      'REED',
      'reed-42',
      'body',
      false,
      {transferCache: false},
    );
  });

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
    const request = searchJobs.mock.calls[0][0];
    expect(request.aspirations.locations).toEqual([]);
    expect(request.workPreferences).not.toHaveProperty('employmentType');
    expect(request.workPreferences).not.toHaveProperty('remotePreference');
    expect(response).toEqual({jobs: [], totalResults: 0});
  });

  it('scopes a paged search to one target role and forwards server sorting', () => {
    const searchJobs = vi.fn((request: JobSearchRequest) => {
      void request;
      return of({jobs: [], totalResults: 0});
    });
    TestBed.configureTestingModule({
      providers: [
        JobService,
        {provide: GeneratedJobSearchService, useValue: {searchJobs}},
        {provide: BrowserSessionService, useValue: {ensureCsrf: vi.fn(() => of(undefined))}},
        {provide: LocationService, useValue: {getByPostcode: vi.fn()}},
      ],
    });

    TestBed.inject(JobService)
      .searchJobs(
        'TypeScript',
        '',
        'Programmer, Software Developer',
        '{}',
        {
          targetRole: 'Software Developer',
          page: 3,
          pageSize: 10,
          sort: 'NEWEST_POSTED',
        },
      )
      .subscribe();

    expect(searchJobs.mock.calls[0][0]).toEqual(expect.objectContaining({
      aspirations: expect.objectContaining({
        desiredRoles: ['Software Developer'],
      }),
      page: 3,
      pageSize: 10,
      sort: 'NEWEST_POSTED',
    }));
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
        JSON.stringify({
          postcode: 'RG1 1AA',
          region: 'South East',
          adminDistrict: 'Reading',
        }),
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

  it('translates profile work choices into only supported search employment types', () => {
    const searchJobs = vi.fn((request: JobSearchRequest) => {
      void request;
      return of({jobs: [], totalResults: 0});
    });
    TestBed.configureTestingModule({
      providers: [
        JobService,
        {provide: GeneratedJobSearchService, useValue: {searchJobs}},
        {provide: BrowserSessionService, useValue: {ensureCsrf: vi.fn(() => of(undefined))}},
        {provide: LocationService, useValue: {getByPostcode: vi.fn()}},
      ],
    });

    TestBed.inject(JobService)
      .searchJobs(
        '',
        '',
        'Software Developer',
        JSON.stringify({
          employmentTypes: ['PERMANENT', 'CONTRACT', 'FIXED_TERM'],
          workingPatterns: ['FULL_TIME', 'FLEXIBLE', 'CONTRACT'],
        }),
      )
      .subscribe();

    expect(searchJobs.mock.calls[0][0].workPreferences!.employmentType)
      .toEqual(['CONTRACT', 'FULL_TIME']);
  });

  it('omits unsupported profile work choices from the search request', () => {
    const searchJobs = vi.fn((request: JobSearchRequest) => {
      void request;
      return of({jobs: [], totalResults: 0});
    });
    TestBed.configureTestingModule({
      providers: [
        JobService,
        {provide: GeneratedJobSearchService, useValue: {searchJobs}},
        {provide: BrowserSessionService, useValue: {ensureCsrf: vi.fn(() => of(undefined))}},
        {provide: LocationService, useValue: {getByPostcode: vi.fn()}},
      ],
    });

    TestBed.inject(JobService)
      .searchJobs(
        '',
        '',
        'Software Developer',
        JSON.stringify({
          employmentTypes: ['PERMANENT', 'APPRENTICESHIP'],
          workingPatterns: ['FLEXIBLE', 'WEEKEND'],
        }),
      )
      .subscribe();

    expect(searchJobs.mock.calls[0][0].workPreferences!)
      .not.toHaveProperty('employmentType');
  });
});
