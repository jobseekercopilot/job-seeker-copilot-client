import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Observable, of, Subject, throwError } from 'rxjs';
import { JobResultsComponent } from './job-results.component';
import { JobSearchOptions, JobService } from '../../services/job.service';
import { DocumentGenerationService } from '../../services/document-generation.service';
import { Job, JobSearchResponse } from '../../models/job-search.model';
import {
  ProviderResultStatus,
  ProviderResultStatusStatusEnum,
  ReedJobSearchResponseMatchingStatusEnum,
  ReedJobSearchResponseSearchStatusEnum,
  TargetRoleJobResultsMatchingStatusEnum,
  TargetRoleJobResultsSearchStatusEnum,
} from '../../api/job-finder';
import { DocumentEvidenceSelectionSectionOrderEnum } from '../../api/document-generation-gateway';
import { ApplicationTrackerService } from '../../services/application-tracker.service';
import { EvidenceLibraryService } from '../../api';

describe('JobResultsComponent', () => {
  const response: JobSearchResponse = {
    resultsByTargetRole: [
      targetRoleResult('cleaning', jobsFor('cleaning', 12), 12, 1, 10, 2),
      targetRoleResult('programming', jobsFor('programming', 16), 16, 1, 10, 2),
    ],
    totalResults: 28,
  };
  let currentResponse = response;
  let searchErrorStatus: number | undefined;
  let queuedSearchResponses: Observable<JobSearchResponse>[] = [];
  let evidenceEntries: any[] = [];

  const jobService = {
    callCount: 0,
    calls: [] as JobSearchOptions[],
    searchJobs: (
      _skills: string,
      _experience: string,
      _aspirations: string,
      _workPrefs: string,
      options: JobSearchOptions = {},
    ) => {
      jobService.callCount++;
      jobService.calls.push(options);
      const queuedResponse = queuedSearchResponses.shift();
      if (queuedResponse) {
        return queuedResponse;
      }
      if (searchErrorStatus != null) {
        return throwError(() => ({status: searchErrorStatus}));
      }
      return of(responseForRequest(currentResponse, options));
    },
  };

  const documentGenerationService = {
    latestFiles: () => of({}),
    generate: vi.fn(() => of({
      applicationId: 'application-1',
      cvDocumentId: 'cv-1',
      coverLetterDocumentId: 'cover-1',
      downloads: {},
    })),
  };

  const applicationTracker = {
    listApplications: vi.fn(() => of([])),
  };
  const evidenceLibrary = {
    listEvidence: () => of(evidenceEntries),
  };

  beforeEach(async () => {
    jobService.callCount = 0;
    jobService.calls = [];
    currentResponse = response;
    searchErrorStatus = undefined;
    queuedSearchResponses = [];
    evidenceEntries = [];
    applicationTracker.listApplications.mockClear();
    documentGenerationService.generate.mockClear();
    await TestBed.configureTestingModule({
      imports: [JobResultsComponent],
      providers: [
        { provide: JobService, useValue: jobService },
        { provide: DocumentGenerationService, useValue: documentGenerationService },
        { provide: ApplicationTrackerService, useValue: applicationTracker },
        { provide: EvidenceLibraryService, useValue: evidenceLibrary },
      ],
    }).compileComponents();
  });

  it('searches only the first role initially and labels untouched roles honestly', () => {
    const fixture = createFixture();

    expect(fixture.nativeElement.textContent).toContain('cleaning');
    expect(fixture.nativeElement.textContent).toContain('(12)');
    expect(fixture.nativeElement.textContent).toContain('programming');
    expect(fixture.nativeElement.textContent).toContain('(Not searched)');
    expect(jobService.calls).toEqual([
      expect.objectContaining({targetRole: 'cleaning', page: 1, pageSize: 10}),
    ]);
  });

  it('shows jobs for the selected target role', () => {
    const fixture = createFixture();

    expect(fixture.nativeElement.textContent).toContain('cleaning job 1');
    expect(fixture.nativeElement.textContent).not.toContain('programming job 1');

    clickButtonContaining(fixture, 'programming');

    expect(fixture.nativeElement.textContent).toContain('programming job 1');
    expect(fixture.nativeElement.textContent).not.toContain('cleaning job 1');
    expect(fixture.nativeElement.textContent).toContain('(16)');
    expect(jobService.calls[1]).toEqual(
      expect.objectContaining({targetRole: 'programming', page: 1, pageSize: 10}),
    );
  });

  it('retains the last successful page when a refresh is rejected', () => {
    const fixture = createFixture();
    expect(jobCards(fixture)).toHaveLength(10);

    searchErrorStatus = 400;
    fixture.componentInstance.refresh();
    fixture.detectChanges();

    expect(fixture.componentInstance.jobs()).toHaveLength(10);
    expect(fixture.componentInstance.roleResults()).toHaveLength(2);
    expect(fixture.componentInstance.totalResults()).toBe(12);
    expect(fixture.componentInstance.error())
      .toBe('Invalid search parameters. Please update your profile and try again.');
    expect(jobCards(fixture)).toHaveLength(10);
  });

  it('shows 10 jobs per page and paginates the selected role only', () => {
    const fixture = createFixture();

    expect(jobCards(fixture)).toHaveLength(10);
    expect(fixture.nativeElement.textContent).toContain('Page 1 of 2');

    clickButtonContaining(fixture, 'Next');

    expect(jobCards(fixture)).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('cleaning job 11');
    expect(fixture.nativeElement.textContent).toContain('Page 2 of 2');
  });

  it('keeps each role page independent when switching tabs', () => {
    const fixture = createFixture();
    clickButtonContaining(fixture, 'Next');

    expect(fixture.nativeElement.textContent).toContain('Page 2 of 2');

    clickButtonContaining(fixture, 'programming');

    expect(fixture.nativeElement.textContent).toContain('programming job 1');
    expect(fixture.nativeElement.textContent).toContain('Page 1 of 2');

    clickButtonContaining(fixture, 'cleaning');

    expect(fixture.nativeElement.textContent).toContain('cleaning job 11');
    expect(fixture.nativeElement.textContent).toContain('Page 2 of 2');
    expect(jobService.calls.filter(call => call.targetRole === 'cleaning')).toHaveLength(2);
  });

  it('keeps the last successful page visible when loading the next page fails', () => {
    queuedSearchResponses = [
      of(rolePageResponse('cleaning', jobsFor('cleaning', 10), 12, 1, 2)),
      throwError(() => ({status: 503})),
    ];
    const fixture = createFixture();

    clickButtonContaining(fixture, 'Next');

    expect(fixture.componentInstance.currentPage()).toBe(1);
    expect(jobCards(fixture)).toHaveLength(10);
    expect(fixture.nativeElement.textContent).toContain('cleaning job 1');
    expect(fixture.nativeElement.textContent)
      .toContain('Job search service is temporarily unavailable');
  });

  it('refreshes only the active role and current page without clearing another role cache', () => {
    const fixture = createFixture();
    clickButtonContaining(fixture, 'programming');
    clickButtonContaining(fixture, 'Next');
    clickButtonContaining(fixture, 'cleaning');

    fixture.componentInstance.refresh();
    fixture.detectChanges();

    expect(jobService.calls.at(-1)).toEqual(expect.objectContaining({
      targetRole: 'cleaning',
      page: 1,
    }));
    expect(fixture.componentInstance.roleStates()['programming'].currentPage).toBe(2);
    expect(fixture.componentInstance.roleStates()['programming'].pages[2].jobs)
      .toHaveLength(6);
  });

  it('sends sort to the server and resets only the active role to page one', () => {
    const fixture = createFixture();
    clickButtonContaining(fixture, 'programming');
    clickButtonContaining(fixture, 'Next');
    clickButtonContaining(fixture, 'cleaning');

    fixture.componentInstance.selectSort('NEWEST_POSTED');
    fixture.detectChanges();

    expect(jobService.calls.at(-1)).toEqual(expect.objectContaining({
      targetRole: 'cleaning',
      page: 1,
      sort: 'NEWEST_POSTED',
    }));
    expect(fixture.componentInstance.roleStates()['cleaning'].sort).toBe('NEWEST_POSTED');
    expect(fixture.componentInstance.roleStates()['programming'].sort).toBe('MOST_RELEVANT');
    expect(fixture.componentInstance.roleStates()['programming'].currentPage).toBe(2);
  });

  it('applies source filter before sorting and paginating', () => {
    currentResponse = singleRoleResponse([
      ...jobsFor('adzuna', 12, 'Adzuna').map((job, index) => ({
        ...job,
        salary: { min: 20000 + index * 1000, max: 30000 + index * 1000, currency: 'GBP', normalisedAnnualMidpoint: 30000 + index * 1000 }
      })),
      ...jobsFor('reed', 4, 'Reed.co.uk').map((job, index) => ({
        ...job,
        salary: { min: 90000 + index * 1000, max: 100000 + index * 1000, currency: 'GBP', normalisedAnnualMidpoint: 100000 + index * 1000 }
      })),
    ]);
    const fixture = createFixture();

    clickButtonContaining(fixture, 'Filter');
    clickButtonContaining(fixture, 'Adzuna');
    fixture.componentInstance.selectSort('HIGHEST_SALARY');
    fixture.detectChanges();

    expect(jobCards(fixture)).toHaveLength(6);
    expect(fixture.nativeElement.textContent)
      .toContain('Showing 6 Adzuna matches on page 1 · 16 total across all job sites');
    expect(fixture.nativeElement.textContent).toContain('adzuna job 12');
    expect(fixture.nativeElement.textContent).not.toContain('reed job 1');
    expect(fixture.nativeElement.textContent).toContain('Page 1 of 2');

    clickButtonContaining(fixture, 'Next');

    expect(jobCards(fixture)).toHaveLength(6);
    expect(fixture.nativeElement.textContent).toContain('adzuna job 6');
  });

  it('sorts highest salary with missing salaries last', () => {
    currentResponse = singleRoleResponse([
      job('missing salary', {}),
      job('hourly normalised high', { salary: { min: 20, max: 40, currency: 'GBP', normalisedAnnualMidpoint: 58500 } }),
      job('yearly normalised low', { salary: { min: 30000, max: 40000, currency: 'GBP', normalisedAnnualMidpoint: 35000 } }),
    ]);
    const fixture = createFixture();

    fixture.componentInstance.selectSort('HIGHEST_SALARY');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text.indexOf('hourly normalised high')).toBeLessThan(text.indexOf('yearly normalised low'));
    expect(text.indexOf('yearly normalised low')).toBeLessThan(text.indexOf('missing salary'));
  });

  it('sorts closest jobs first with missing distances last', () => {
    currentResponse = singleRoleResponse([
      job('missing distance', {}),
      job('far job', { distanceMiles: 30 }),
      job('near job', { distanceMiles: 2 }),
    ]);
    const fixture = createFixture();

    fixture.componentInstance.selectSort('CLOSEST');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text.indexOf('near job')).toBeLessThan(text.indexOf('far job'));
    expect(text.indexOf('far job')).toBeLessThan(text.indexOf('missing distance'));
  });

  it('shows distance text rounded to one decimal place when available', () => {
    currentResponse = singleRoleResponse([
      job('near job', { distanceMiles: 3.44 }),
      job('missing distance', {}),
    ]);
    const fixture = createFixture();

    expect(fixture.nativeElement.textContent).toContain('3.4 miles from you');
    expect(fixture.nativeElement.textContent).not.toContain('null miles');
  });

  it('keeps successful real jobs visible when another provider is rate limited', () => {
    currentResponse = singleRoleResponse(
      [job('real developer role', {})],
      'developer',
      [
        {provider: 'REED', status: ProviderResultStatusStatusEnum.Success, rawResultCount: 1},
        {provider: 'JSEARCH', status: ProviderResultStatusStatusEnum.RateLimited, rawResultCount: 0},
      ],
      TargetRoleJobResultsSearchStatusEnum.Partial,
    );
    const fixture = createFixture('REAL_PROVIDERS');

    expect(fixture.nativeElement.textContent).toContain('Real providers — partial availability');
    expect(fixture.nativeElement.textContent).toContain('real developer role');
    expect(fixture.nativeElement.textContent).toContain('JSEARCH has reached its current request limit');
  });

  it('keeps provider partial failures scoped to the role that returned them', () => {
    queuedSearchResponses = [
      of(rolePageResponse(
        'cleaning',
        [job('cleaning result', {})],
        1,
        1,
        1,
        [
          {provider: 'REED', status: ProviderResultStatusStatusEnum.Success, rawResultCount: 1},
        ],
      )),
      of(rolePageResponse(
        'programming',
        [job('programming result', {})],
        1,
        1,
        1,
        [
          {provider: 'REED', status: ProviderResultStatusStatusEnum.Success, rawResultCount: 1},
          {provider: 'JSEARCH', status: ProviderResultStatusStatusEnum.RateLimited, rawResultCount: 0},
        ],
        TargetRoleJobResultsSearchStatusEnum.Partial,
        TargetRoleJobResultsMatchingStatusEnum.TimedOut,
      )),
    ];
    const fixture = createFixture('REAL_PROVIDERS');

    clickButtonContaining(fixture, 'programming');

    expect(fixture.nativeElement.textContent)
      .toContain('JSEARCH has reached its current request limit');
    expect(fixture.nativeElement.textContent).toContain('programming result');
    expect(fixture.componentInstance.searchStatus())
      .toBe(TargetRoleJobResultsSearchStatusEnum.Partial);
    expect(fixture.componentInstance.matchingStatus())
      .toBe(TargetRoleJobResultsMatchingStatusEnum.TimedOut);

    clickButtonContaining(fixture, 'cleaning');

    expect(fixture.nativeElement.textContent)
      .not.toContain('JSEARCH has reached its current request limit');
    expect(fixture.nativeElement.textContent).toContain('cleaning result');
    expect(fixture.componentInstance.searchStatus())
      .toBe(TargetRoleJobResultsSearchStatusEnum.Complete);
    expect(fixture.componentInstance.matchingStatus())
      .toBe(TargetRoleJobResultsMatchingStatusEnum.Complete);
  });

  it('shows one role failure without discarding another role cached results', () => {
    queuedSearchResponses = [
      of(rolePageResponse('cleaning', [job('cached cleaning result', {})], 1, 1, 1)),
      throwError(() => ({status: 503})),
    ];
    const fixture = createFixture();

    clickButtonContaining(fixture, 'programming');

    expect(fixture.nativeElement.textContent).toContain('programming (Unavailable)');
    expect(fixture.nativeElement.textContent)
      .toContain('Job search service is temporarily unavailable');

    clickButtonContaining(fixture, 'cleaning');

    expect(fixture.nativeElement.textContent).toContain('cached cleaning result');
    expect(fixture.componentInstance.error()).toBeNull();
  });

  it('distinguishes a real-provider configuration error from zero results', () => {
    currentResponse = singleRoleResponse(
      [],
      'developer',
      [
        {provider: 'REED', status: ProviderResultStatusStatusEnum.ConfigurationError, rawResultCount: 0},
      ],
      TargetRoleJobResultsSearchStatusEnum.Unavailable,
      TargetRoleJobResultsMatchingStatusEnum.Unavailable,
    );
    const fixture = createFixture('REAL_PROVIDERS');

    expect(fixture.nativeElement.textContent).toContain('Real-provider configuration error');
    expect(fixture.nativeElement.textContent)
      .toContain('Real-provider configuration is incomplete. No fixture results were substituted.');
  });

  it('distinguishes unavailable real providers from a successful zero-result search', () => {
    currentResponse = singleRoleResponse(
      [],
      'developer',
      [
        {provider: 'ADZUNA', status: ProviderResultStatusStatusEnum.Unavailable, rawResultCount: 0},
      ],
      TargetRoleJobResultsSearchStatusEnum.Unavailable,
      TargetRoleJobResultsMatchingStatusEnum.Unavailable,
    );
    const unavailable = createFixture('REAL_PROVIDERS');
    expect(unavailable.nativeElement.textContent).toContain('Real providers temporarily unavailable');
    expect(unavailable.nativeElement.textContent)
      .toContain('Real job providers are temporarily unavailable. Please try again later.');

    currentResponse = singleRoleResponse(
      [],
      'developer',
      [
        {provider: 'ADZUNA', status: ProviderResultStatusStatusEnum.Success, rawResultCount: 0},
      ],
    );
    const zeroResults = createFixture('REAL_PROVIDERS');
    expect(zeroResults.nativeElement.textContent).toContain('Real providers');
    expect(zeroResults.nativeElement.textContent)
      .toContain('No job matches found based on your current profile.');
  });

  it('renders authoritative application enrichment on initial load and reload without listing applications', () => {
    currentResponse = singleRoleResponse([
      job('persisted role', {
        id: 'canonical-job-1',
        canonicalJobId: 'canonical-job-1',
        primarySource: 'REED',
        externalJobId: 'reed-123',
        applicationId: 'application-1',
        applicationStatus: 'DOCUMENTS_GENERATED',
        cvDocumentId: 'cv-1',
        coverLetterDocumentId: 'letter-1',
        applicationUpdatedAt: '2026-07-28T09:04:00Z',
      }),
    ]);

    const initialFixture = createFixture();
    initialFixture.debugElement.query(By.css('.job-main-toggle')).nativeElement.click();
    initialFixture.detectChanges();

    expect(initialFixture.componentInstance.jobs()[0]).toMatchObject({
      id: 'canonical-job-1',
      applicationId: 'application-1',
      applicationStatus: 'DOCUMENTS_GENERATED',
      cvDocumentId: 'cv-1',
      coverLetterDocumentId: 'letter-1',
    });
    expect(initialFixture.nativeElement.textContent).toContain('Documents prepared');
    expect(initialFixture.nativeElement.textContent).not.toContain('Generate CV & Cover Letter');
    expect(initialFixture.nativeElement.textContent).toContain('Upload CV');
    initialFixture.destroy();

    const reloadedFixture = createFixture();
    reloadedFixture.debugElement.query(By.css('.job-main-toggle')).nativeElement.click();
    reloadedFixture.detectChanges();

    expect(reloadedFixture.componentInstance.jobs()[0]).toMatchObject({
      id: 'canonical-job-1',
      applicationId: 'application-1',
      applicationStatus: 'DOCUMENTS_GENERATED',
      cvDocumentId: 'cv-1',
      coverLetterDocumentId: 'letter-1',
    });
    expect(reloadedFixture.nativeElement.textContent).toContain('Documents prepared');
    expect(reloadedFixture.nativeElement.textContent).toContain('Upload CV');
    expect(applicationTracker.listApplications).not.toHaveBeenCalled();
  });

  it('does not allow a stale overlapping search response to overwrite newer results', () => {
    const staleResponse = new Subject<JobSearchResponse>();
    const newerResponse = new Subject<JobSearchResponse>();
    queuedSearchResponses = [staleResponse, newerResponse];
    const fixture = createFixture();

    fixture.componentInstance.refresh();
    newerResponse.next(singleRoleResponse([job('newer result', {})], 'cleaning'));
    newerResponse.complete();
    fixture.detectChanges();

    expect(fixture.componentInstance.jobs().map(result => result.title)).toEqual(['newer result']);
    expect(fixture.nativeElement.textContent).toContain('newer result');

    staleResponse.next(singleRoleResponse([job('stale result', {})], 'cleaning'));
    staleResponse.complete();
    fixture.detectChanges();

    expect(fixture.componentInstance.jobs().map(result => result.title)).toEqual(['newer result']);
    expect(fixture.nativeElement.textContent).not.toContain('stale result');
  });

  it('rejects a response whose target-role group does not match the requested role', () => {
    queuedSearchResponses = [
      of(rolePageResponse('programming', [job('wrong-role result', {})], 1, 1, 1)),
    ];
    const fixture = createFixture();

    expect(fixture.componentInstance.jobs()).toEqual([]);
    expect(fixture.componentInstance.error())
      .toBe('Search results for this target role could not be verified. Please try again.');
    expect(fixture.nativeElement.textContent).not.toContain('wrong-role result');
  });

  it('prefers matching role metadata over conflicting legacy top-level metadata', () => {
    queuedSearchResponses = [
      of({
        ...rolePageResponse(
          'cleaning',
          [job('nested metadata result', {})],
          17,
          2,
          4,
          [
            {
              provider: 'JSEARCH',
              status: ProviderResultStatusStatusEnum.RateLimited,
              rawResultCount: 0,
            },
          ],
          TargetRoleJobResultsSearchStatusEnum.Partial,
          TargetRoleJobResultsMatchingStatusEnum.TimedOut,
          5,
        ),
        totalResults: 999,
        page: 99,
        pageSize: 50,
        totalPages: 100,
        providerResults: [
          {
            provider: 'REED',
            status: ProviderResultStatusStatusEnum.Success,
            rawResultCount: 1,
          },
        ],
        searchStatus: ReedJobSearchResponseSearchStatusEnum.Complete,
        matchingStatus: ReedJobSearchResponseMatchingStatusEnum.Complete,
      }),
    ];

    const fixture = createFixture('REAL_PROVIDERS');
    const state = fixture.componentInstance.roleStates()['cleaning'];

    expect(state.currentPage).toBe(2);
    expect(state.pageSize).toBe(5);
    expect(state.totalResults).toBe(17);
    expect(state.totalPages).toBe(4);
    expect(state.providerStatuses).toEqual([
      ProviderResultStatusStatusEnum.RateLimited,
    ]);
    expect(state.searchStatus).toBe(TargetRoleJobResultsSearchStatusEnum.Partial);
    expect(state.matchingStatus).toBe(TargetRoleJobResultsMatchingStatusEnum.TimedOut);
    expect(fixture.nativeElement.textContent)
      .toContain('JSEARCH has reached its current request limit');
  });

  it('falls back to top-level metadata for a legacy matching role group', () => {
    const legacyResponse = {
      jobs: [job('legacy metadata result', {})],
      resultsByTargetRole: [{
        targetRole: 'cleaning',
        jobs: [job('legacy metadata result', {})],
      }],
      totalResults: 13,
      page: 2,
      pageSize: 5,
      totalPages: 3,
      providerResults: [{
        provider: 'JSEARCH',
        status: ProviderResultStatusStatusEnum.RateLimited,
        rawResultCount: 0,
      }],
      searchStatus: ReedJobSearchResponseSearchStatusEnum.Partial,
      matchingStatus: ReedJobSearchResponseMatchingStatusEnum.TimedOut,
    } as unknown as JobSearchResponse;
    queuedSearchResponses = [of(legacyResponse)];

    const fixture = createFixture('REAL_PROVIDERS');
    const state = fixture.componentInstance.roleStates()['cleaning'];

    expect(state.currentPage).toBe(2);
    expect(state.pageSize).toBe(5);
    expect(state.totalResults).toBe(13);
    expect(state.totalPages).toBe(3);
    expect(state.providerStatuses).toEqual([
      ProviderResultStatusStatusEnum.RateLimited,
    ]);
    expect(state.searchStatus).toBe(ReedJobSearchResponseSearchStatusEnum.Partial);
    expect(state.matchingStatus).toBe(ReedJobSearchResponseMatchingStatusEnum.TimedOut);
  });

  it('restores page-scoped statuses when returning to a cached page', () => {
    queuedSearchResponses = [
      of(rolePageResponse(
        'cleaning',
        jobsFor('cleaning', 10),
        11,
        1,
        2,
        [{
          provider: 'REED',
          status: ProviderResultStatusStatusEnum.Success,
          rawResultCount: 10,
        }],
      )),
      of(rolePageResponse(
        'cleaning',
        [job('partial page two result', {})],
        11,
        2,
        2,
        [{
          provider: 'JSEARCH',
          status: ProviderResultStatusStatusEnum.RateLimited,
          rawResultCount: 0,
        }],
        TargetRoleJobResultsSearchStatusEnum.Partial,
        TargetRoleJobResultsMatchingStatusEnum.Saturated,
      )),
    ];
    const fixture = createFixture('REAL_PROVIDERS');

    clickButtonContaining(fixture, 'Next');
    expect(fixture.componentInstance.searchStatus())
      .toBe(TargetRoleJobResultsSearchStatusEnum.Partial);
    expect(fixture.componentInstance.matchingStatus())
      .toBe(TargetRoleJobResultsMatchingStatusEnum.Saturated);

    clickButtonContaining(fixture, 'Previous');
    expect(fixture.componentInstance.searchStatus())
      .toBe(TargetRoleJobResultsSearchStatusEnum.Complete);
    expect(fixture.componentInstance.matchingStatus())
      .toBe(TargetRoleJobResultsMatchingStatusEnum.Complete);
    expect(fixture.componentInstance.providerStatuses())
      .toEqual([ProviderResultStatusStatusEnum.Success]);
    expect(jobService.calls).toHaveLength(2);
  });

  it('keeps application and document enrichment on a subsequently loaded page', () => {
    currentResponse = singleRoleResponse(
      [
        ...jobsFor('cleaning', 10),
        job('enriched page two result', {
          id: 'canonical-enriched-page-two',
          canonicalJobId: 'canonical-enriched-page-two',
          applicationId: 'application-page-two',
          applicationStatus: 'DOCUMENTS_GENERATED',
          cvDocumentId: 'cv-page-two',
          coverLetterDocumentId: 'cover-page-two',
        }),
      ],
      'cleaning',
    );
    const fixture = createFixture();

    clickButtonContaining(fixture, 'Next');
    fixture.debugElement.query(By.css('.job-main-toggle')).nativeElement.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('enriched page two result');
    expect(fixture.nativeElement.textContent).toContain('Documents prepared');
    expect(fixture.componentInstance.jobs().find(candidate =>
      candidate.canonicalJobId === 'canonical-enriched-page-two')).toMatchObject({
        applicationId: 'application-page-two',
        cvDocumentId: 'cv-page-two',
        coverLetterDocumentId: 'cover-page-two',
      });
  });

  it('removes canonical duplicates returned across page boundaries', () => {
    const firstPage = jobsFor('cleaning', 10);
    queuedSearchResponses = [
      of(rolePageResponse('cleaning', firstPage, 11, 1, 2)),
      of(rolePageResponse(
        'cleaning',
        [firstPage[9], job('cleaning unique page two', {id: 'cleaning-11'})],
        11,
        2,
        2,
      )),
    ];
    const fixture = createFixture();

    clickButtonContaining(fixture, 'Next');

    expect(jobCards(fixture)).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('cleaning unique page two');
    expect(fixture.nativeElement.textContent).not.toContain('cleaning job 10');
    expect(fixture.componentInstance.jobs().filter(candidate =>
      fixture.componentInstance.jobStateKey(candidate) === 'cleaning-10')).toHaveLength(1);
    expect(fixture.componentInstance.jobs()).toHaveLength(11);
  });

  it('requires separate explicit evidence selections and preserves claimant order', () => {
    evidenceEntries = [
      evidenceEntry(
        '50000000-0000-4000-8000-000000000001',
        'PROJECT',
        'Job Seeker Copilot project',
        3,
      ),
      evidenceEntry(
        '50000000-0000-4000-8000-000000000002',
        'VOLUNTEERING',
        'Community support volunteer',
        2,
      ),
      evidenceEntry(
        '50000000-0000-4000-8000-000000000003',
        'EMPLOYMENT',
        'Unconfirmed role',
        1,
        'DRAFT',
      ),
    ];
    const fixture = createFixture();
    const selectedJob = fixture.componentInstance.paginatedJobs()[0];

    fixture.componentInstance.openEvidenceSelection(selectedJob);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Nothing is included automatically');
    expect(fixture.nativeElement.textContent).toContain('confirmed revision 3');
    expect(fixture.nativeElement.textContent).not.toContain('Unconfirmed role');
    expect(fixture.componentInstance.canGenerateFromSelection()).toBe(false);

    const [project, volunteering] = fixture.componentInstance.eligibleEvidence();
    fixture.componentInstance.toggleEvidence('CV', project);
    fixture.componentInstance.toggleEvidence('CV', volunteering);
    fixture.componentInstance.moveEvidence('CV', volunteering.entryId, -1);
    fixture.componentInstance.moveEvidenceSection(
      'CV',
      DocumentEvidenceSelectionSectionOrderEnum.Volunteering,
      -1,
    );
    fixture.componentInstance.toggleEvidence('COVER_LETTER', project);
    fixture.detectChanges();

    expect(fixture.componentInstance.canGenerateFromSelection()).toBe(true);
    fixture.componentInstance.confirmEvidenceGeneration();

    expect(documentGenerationService.generate).toHaveBeenCalledWith(
      selectedJob,
      {
        cv: {
          entryIds: [volunteering.entryId, project.entryId],
          sectionOrder: ['VOLUNTEERING', 'PROJECT'],
        },
        coverLetter: {
          entryIds: [project.entryId],
          sectionOrder: ['PROJECT'],
        },
      },
    );
  });

  it('reports insufficient credit without implying that OpenAI failed', () => {
    evidenceEntries = [
      evidenceEntry(
        '50000000-0000-4000-8000-000000000001',
        'PROJECT',
        'Portfolio project',
        1,
      ),
    ];
    documentGenerationService.generate.mockReturnValueOnce(
      throwError(() => new Error(
        '{"status":402,"message":"Insufficient AI Credit","errors":null}',
      )),
    );
    const fixture = createFixture();
    const selectedJob = fixture.componentInstance.paginatedJobs()[0];

    fixture.componentInstance.openEvidenceSelection(selectedJob);
    const [project] = fixture.componentInstance.eligibleEvidence();
    fixture.componentInstance.toggleEvidence('CV', project);
    fixture.componentInstance.toggleEvidence('COVER_LETTER', project);
    fixture.componentInstance.confirmEvidenceGeneration();
    fixture.detectChanges();

    expect(fixture.componentInstance.generationErrors()[selectedJob.id!])
      .toBe('Insufficient AI Credit for this job. No OpenAI request was made.');
  });

  function createFixture(providerMode: 'FIXTURE' | 'REAL_PROVIDERS' | 'REQUIRED_VALIDATION' = 'FIXTURE') {
    const fixture = TestBed.createComponent(JobResultsComponent);
    fixture.componentRef.setInput('authToken', 'token');
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('aspirations', 'cleaning, programming');
    fixture.componentRef.setInput('workPrefs', JSON.stringify({ postcode: 'SW1A 1AA', hours: 'full time' }));
    fixture.componentRef.setInput('providerMode', providerMode);
    fixture.componentRef.setInput('applicationToolsAvailable', true);
    fixture.componentRef.setInput('applicationTrackingAvailable', true);
    fixture.detectChanges();
    return fixture;
  }

  function clickButtonContaining(fixture: ReturnType<typeof createFixture>, text: string): void {
    const button = fixture.debugElement
      .queryAll(By.css('button'))
      .find(candidate => candidate.nativeElement.textContent.includes(text));
    expect(button).toBeTruthy();
    button!.nativeElement.click();
    fixture.detectChanges();
  }

  function jobCards(fixture: ReturnType<typeof createFixture>) {
    return fixture.debugElement.queryAll(By.css('app-job-card'));
  }

  function singleRoleResponse(
    jobs: Job[],
    targetRole = 'developer',
    providerResults: ProviderResultStatus[] = [],
    searchStatus: TargetRoleJobResultsSearchStatusEnum = TargetRoleJobResultsSearchStatusEnum.Complete,
    matchingStatus: TargetRoleJobResultsMatchingStatusEnum = TargetRoleJobResultsMatchingStatusEnum.Complete,
  ): JobSearchResponse {
    return {
      jobs,
      resultsByTargetRole: [
        targetRoleResult(
          targetRole,
          jobs,
          jobs.length,
          1,
          10,
          Math.max(1, Math.ceil(jobs.length / 10)),
          providerResults,
          searchStatus,
          matchingStatus,
        ),
      ],
      totalResults: jobs.length,
      page: 1,
      pageSize: 10,
      totalPages: Math.max(1, Math.ceil(jobs.length / 10)),
      providerResults,
    };
  }

  function rolePageResponse(
    targetRole: string,
    jobs: Job[],
    totalResults: number,
    page: number,
    totalPages: number,
    providerResults: ProviderResultStatus[] = [],
    searchStatus: TargetRoleJobResultsSearchStatusEnum = TargetRoleJobResultsSearchStatusEnum.Complete,
    matchingStatus: TargetRoleJobResultsMatchingStatusEnum = TargetRoleJobResultsMatchingStatusEnum.Complete,
    pageSize = 10,
  ): JobSearchResponse {
    return {
      jobs,
      resultsByTargetRole: [
        targetRoleResult(
          targetRole,
          jobs,
          totalResults,
          page,
          pageSize,
          totalPages,
          providerResults,
          searchStatus,
          matchingStatus,
        ),
      ],
      totalResults,
      page,
      pageSize,
      totalPages,
      providerResults,
    };
  }

  function targetRoleResult(
    targetRole: string,
    jobs: Job[],
    totalResults: number,
    page: number,
    pageSize: number,
    totalPages: number,
    providerResults: ProviderResultStatus[] = [],
    searchStatus: TargetRoleJobResultsSearchStatusEnum = TargetRoleJobResultsSearchStatusEnum.Complete,
    matchingStatus: TargetRoleJobResultsMatchingStatusEnum = TargetRoleJobResultsMatchingStatusEnum.Complete,
  ): NonNullable<JobSearchResponse['resultsByTargetRole']>[number] {
    return {
      targetRole,
      jobs,
      totalResults,
      page,
      pageSize,
      totalPages,
      providerResults,
      searchStatus,
      matchingStatus,
    };
  }

  function responseForRequest(
    source: JobSearchResponse,
    options: JobSearchOptions,
  ): JobSearchResponse {
    const targetRole = options.targetRole ?? 'All matches';
    const group = source.resultsByTargetRole?.find(candidate =>
      candidate.targetRole?.toLocaleLowerCase() === targetRole.toLocaleLowerCase())
      ?? (source.resultsByTargetRole?.length === 1
        ? source.resultsByTargetRole[0]
        : undefined);
    const allJobs = sortJobs(group?.jobs ?? source.jobs ?? [], options.sort);
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 10;
    const start = (page - 1) * pageSize;
    const pageJobs = allJobs.slice(start, start + pageSize);
    const totalPages = Math.max(1, Math.ceil(allJobs.length / pageSize));
    const providerResults = group?.providerResults ?? source.providerResults ?? [];
    const searchStatus = (
      group?.searchStatus
      ?? source.searchStatus
      ?? TargetRoleJobResultsSearchStatusEnum.Complete
    ) as TargetRoleJobResultsSearchStatusEnum;
    const matchingStatus = (
      group?.matchingStatus
      ?? source.matchingStatus
      ?? TargetRoleJobResultsMatchingStatusEnum.Complete
    ) as TargetRoleJobResultsMatchingStatusEnum;
    return {
      ...source,
      jobs: pageJobs,
      resultsByTargetRole: [
        targetRoleResult(
          targetRole,
          pageJobs,
          allJobs.length,
          page,
          pageSize,
          totalPages,
          providerResults,
          searchStatus,
          matchingStatus,
        ),
      ],
      totalResults: allJobs.length,
      page,
      pageSize,
      totalPages,
      providerResults,
      sort: options.sort as JobSearchResponse['sort'],
    };
  }

  function sortJobs(jobs: Job[], sort: string | undefined): Job[] {
    const sorted = [...jobs];
    if (sort === 'HIGHEST_SALARY') {
      return sorted.sort((left, right) =>
        (right.salary?.normalisedAnnualMidpoint ?? Number.NEGATIVE_INFINITY)
        - (left.salary?.normalisedAnnualMidpoint ?? Number.NEGATIVE_INFINITY));
    }
    if (sort === 'CLOSEST') {
      return sorted.sort((left, right) =>
        (left.distanceMiles ?? Number.POSITIVE_INFINITY)
        - (right.distanceMiles ?? Number.POSITIVE_INFINITY));
    }
    return sorted;
  }

  function job(title: string, patch: Partial<Job>): Job {
    return {
      id: title.toLowerCase().replaceAll(' ', '-'),
      title,
      company: 'Example Ltd',
      location: 'London',
      postedDate: '2026-06-25',
      description: 'Useful work.',
      url: 'https://example.com/job',
      sources: [{ publisher: 'Adzuna' }],
      ...patch,
    };
  }

  function jobsFor(role: string, count: number, publisher = 'Reed.co.uk'): Job[] {
    return Array.from({ length: count }, (_, index) => ({
      id: `${role}-${index + 1}`,
      title: `${role} job ${index + 1}`,
      company: 'Example Ltd',
      location: 'London',
      salary: { min: 20000, max: 30000, currency: 'GBP' },
      postedDate: '2026-06-25',
      description: 'Useful work.',
      url: 'https://example.com/job',
      sources: [{ publisher }],
    }));
  }

  function evidenceEntry(
    entryId: string,
    category: string,
    heading: string,
    revisionNumber: number,
    confirmationState = 'USER_CONFIRMED',
  ): any {
    return {
      entryId,
      category,
      visibility: 'VISIBLE',
      lifecycle: 'ACTIVE',
      reviewRequired: false,
      version: revisionNumber,
      revisions: [{
        revisionId: entryId.replace('50000000', '60000000'),
        revisionNumber,
        confirmationState,
        contentDigest: 'a'.repeat(64),
        heading,
        ongoing: false,
        demonstratedSkills: [],
        supportingLinks: [],
        facts: [],
        createdAt: '2026-07-29T00:00:00Z',
        createdBy: 'USER',
      }],
    };
  }
});
