import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Observable, of, Subject, throwError } from 'rxjs';
import { JobResultsComponent } from './job-results.component';
import { JobSearchOptions, JobService } from '../../services/job.service';
import {
  DocumentGenerationError,
  DocumentGenerationService,
  PendingDocumentGeneration,
} from '../../services/document-generation.service';
import { Job, JobSearchResponse } from '../../models/job-search.model';
import {
  ProviderResultStatus,
  ProviderResultStatusStatusEnum,
  JobDescriptionCompletenessEnum,
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
  let queuedEvidenceResponses: Observable<any[]>[] = [];
  let evidenceEntries: any[] = [];
  let pendingGenerations: PendingDocumentGeneration[] = [];

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
    getJobDetails: vi.fn(
      (_provider: string, _externalJobId: string): Observable<Job> =>
        throwError(() => ({status: 404})),
    ),
  };

  const documentGenerationService = {
    latestFiles: () => of({}),
    pendingGenerations: vi.fn(() => pendingGenerations),
    resume: vi.fn(() => new Subject<any>()),
    cancel: vi.fn(() => of(undefined)),
    uploadReplacement: vi.fn(),
    uploadApplicationDocument: vi.fn(),
    generate: vi.fn(() => of({
      applicationId: 'application-1',
      cvDocumentId: 'cv-1',
      coverLetterDocumentId: 'cover-1',
      downloads: {},
    })),
  };

  const applicationTracker = {
    listApplications: vi.fn(() => of([])),
    createApplication: vi.fn(),
    updateStatus: vi.fn(),
    withdrawGeneratedApplication: vi.fn(),
  };
  const evidenceLibrary = {
    listEvidence: vi.fn(() => queuedEvidenceResponses.shift() ?? of(evidenceEntries)),
  };

  beforeEach(async () => {
    jobService.callCount = 0;
    jobService.calls = [];
    jobService.getJobDetails.mockReset();
    jobService.getJobDetails.mockImplementation(
      (): Observable<Job> => throwError(() => ({status: 404})),
    );
    currentResponse = response;
    searchErrorStatus = undefined;
    queuedSearchResponses = [];
    queuedEvidenceResponses = [];
    evidenceEntries = [];
    pendingGenerations = [];
    applicationTracker.listApplications.mockClear();
    documentGenerationService.pendingGenerations.mockClear();
    documentGenerationService.resume.mockClear();
    documentGenerationService.resume.mockImplementation(() => new Subject<any>());
    documentGenerationService.cancel.mockClear();
    documentGenerationService.cancel.mockImplementation(() => of(undefined));
    documentGenerationService.uploadReplacement.mockReset();
    documentGenerationService.uploadApplicationDocument.mockReset();
    documentGenerationService.generate.mockClear();
    documentGenerationService.generate.mockImplementation(() => of({
      applicationId: 'application-1',
      cvDocumentId: 'cv-1',
      coverLetterDocumentId: 'cover-1',
      downloads: {},
    }));
    applicationTracker.createApplication.mockReset();
    applicationTracker.updateStatus.mockReset();
    applicationTracker.withdrawGeneratedApplication.mockReset();
    evidenceLibrary.listEvidence.mockClear();
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

  it('requires separate explicit evidence selections and preserves section ordering', () => {
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
    fixture.componentInstance.moveEvidenceSection(
      'CV',
      DocumentEvidenceSelectionSectionOrderEnum.Volunteering,
      -1,
    );
    fixture.componentInstance.toggleEvidence('COVER_LETTER', project);
    confirmGenerationAdvert(fixture);
    fixture.detectChanges();

    expect(fixture.componentInstance.canGenerateFromSelection()).toBe(true);
    fixture.componentInstance.confirmEvidenceGeneration();

    expect(documentGenerationService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: selectedJob.id,
        description: expect.stringContaining('Build and launch production software'),
      }),
      {
        cv: {
          entryIds: [project.entryId, volunteering.entryId],
          sectionOrder: ['VOLUNTEERING', 'PROJECT'],
        },
        coverLetter: {
          entryIds: [project.entryId],
          sectionOrder: ['PROJECT'],
        },
      },
    );
  });

  it('creates the application before offering an explicit non-empty generation choice', () => {
    const applicationId = '10000000-0000-4000-8000-000000000001';
    currentResponse = singleRoleResponse([job('Application-first role', {
      id: 'application-first-role',
      canonicalJobId: 'canonical-application-first-role',
      primarySource: 'ADZUNA',
      externalJobId: 'external-1',
    })]);
    applicationTracker.createApplication.mockReturnValue(of({
      id: applicationId,
      status: 'SAVED',
    }));
    const fixture = createFixture();
    const selectedJob = fixture.componentInstance.paginatedJobs()[0];

    fixture.componentInstance.prepareApplicationDocuments(selectedJob, 'GENERATE');
    fixture.detectChanges();

    expect(applicationTracker.createApplication).toHaveBeenCalledWith(selectedJob);
    expect(documentGenerationService.generate).not.toHaveBeenCalled();
    expect(fixture.componentInstance.documentChoiceJob()).toMatchObject({applicationId});
    expect(fixture.componentInstance.canContinueDocumentChoice()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Application saved');
    expect(fixture.nativeElement.textContent).toContain('Uploading is free');

    fixture.componentInstance.chooseDocumentAction('CV', 'GENERATE');
    fixture.componentInstance.chooseDocumentAction('COVER_LETTER', 'OMIT');
    expect(fixture.componentInstance.canContinueDocumentChoice()).toBe(true);
    fixture.componentInstance.continueDocumentChoice();
    fixture.detectChanges();

    expect(fixture.componentInstance.evidenceSelectionJob()).toMatchObject({applicationId});
    expect(fixture.componentInstance.activeEvidencePurposes()).toEqual(['CV']);
    expect(fixture.nativeElement.textContent).toContain('Generate CV (1 AI Credit)');
    expect(fixture.nativeElement.textContent).not.toContain('Cover letter evidence');
  });

  it('supports an upload-only Add path without generation or AI Credit use', () => {
    const applicationId = '10000000-0000-4000-8000-000000000002';
    const documentId = '20000000-0000-4000-8000-000000000002';
    currentResponse = singleRoleResponse([job('Upload-only role', {
      id: 'upload-only-role',
      canonicalJobId: 'canonical-upload-only-role',
      primarySource: 'ADZUNA',
      externalJobId: 'external-2',
    })]);
    applicationTracker.createApplication.mockReturnValue(of({
      id: applicationId,
      status: 'SAVED',
    }));
    documentGenerationService.uploadApplicationDocument.mockImplementation(
      (request: any, onProgress: (progress: any) => void) => {
        onProgress({phase: 'UPLOADING', loadedBytes: request.file.size, totalBytes: request.file.size, percent: 100});
        return of({
          operationId: '30000000-0000-4000-8000-000000000002',
          applicationId,
          jobId: request.jobId,
          documentType: request.documentType,
          fileType: 'PDF',
          state: 'COMPLETED',
          documentId,
        });
      },
    );
    const fixture = createFixture();
    const selectedJob = fixture.componentInstance.paginatedJobs()[0];

    fixture.componentInstance.trackApplication(selectedJob);
    fixture.componentInstance.chooseDocumentAction('CV', 'UPLOAD');
    fixture.componentInstance.chooseDocumentAction('COVER_LETTER', 'OMIT');
    const file = new File(['safe content'], 'existing-cv.pdf', {type: 'application/pdf'});
    fixture.componentInstance.documentChoiceFiles.set({CV: file, COVER_LETTER: null});
    fixture.componentInstance.continueDocumentChoice();
    fixture.detectChanges();

    expect(documentGenerationService.generate).not.toHaveBeenCalled();
    expect(documentGenerationService.uploadApplicationDocument).toHaveBeenCalledOnce();
    expect(documentGenerationService.uploadApplicationDocument.mock.calls[0][0]).toMatchObject({
      applicationId,
      jobId: 'canonical-upload-only-role',
      documentType: 'CV',
      file,
    });
    expect(fixture.componentInstance.jobs()[0].cvDocumentId).toBe(documentId);
    expect(fixture.componentInstance.applicationUploadState(selectedJob, 'CV')).toMatchObject({
      phase: 'COMPLETED',
      percent: 100,
    });
  });

  it('retries one failed mixed upload with the same identity and can skip it independently', () => {
    const applicationId = '10000000-0000-4000-8000-000000000003';
    const existingCvId = '20000000-0000-4000-8000-000000000003';
    const uploadedLetterId = '20000000-0000-4000-8000-000000000004';
    currentResponse = singleRoleResponse([job('Mixed documents role', {
      id: 'mixed-documents-role',
      canonicalJobId: 'canonical-mixed-documents-role',
      applicationId,
      cvDocumentId: existingCvId,
    })]);
    documentGenerationService.uploadApplicationDocument
      .mockReturnValueOnce(throwError(() => new Error('Temporary upload failure.')))
      .mockReturnValueOnce(of({
        operationId: '30000000-0000-4000-8000-000000000003',
        applicationId,
        jobId: 'canonical-mixed-documents-role',
        documentType: 'COVER_LETTER',
        fileType: 'DOCX',
        state: 'COMPLETED',
        documentId: uploadedLetterId,
      }));
    const fixture = createFixture();
    const selectedJob = fixture.componentInstance.paginatedJobs()[0];
    const file = new File(['letter'], 'letter.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    fixture.componentInstance.prepareApplicationDocuments(selectedJob, 'GENERATE');
    fixture.componentInstance.chooseDocumentAction('CV', 'GENERATE');
    fixture.componentInstance.chooseDocumentAction('COVER_LETTER', 'UPLOAD');
    fixture.componentInstance.documentChoiceFiles.set({CV: null, COVER_LETTER: file});
    fixture.componentInstance.continueDocumentChoice();

    const firstRequest = documentGenerationService.uploadApplicationDocument.mock.calls[0][0];
    expect(fixture.componentInstance.applicationUploadState(selectedJob, 'COVER_LETTER')).toMatchObject({
      phase: 'ERROR',
      canRetry: true,
    });
    expect(fixture.componentInstance.activeEvidencePurposes()).toEqual(['CV']);

    fixture.componentInstance.retryApplicationUpload(selectedJob, 'COVER_LETTER');

    const retryRequest = documentGenerationService.uploadApplicationDocument.mock.calls[1][0];
    expect(retryRequest.idempotencyKey).toBe(firstRequest.idempotencyKey);
    expect(fixture.componentInstance.jobs()[0]).toMatchObject({
      cvDocumentId: existingCvId,
      coverLetterDocumentId: uploadedLetterId,
    });
    fixture.componentInstance.skipApplicationUpload(selectedJob, 'COVER_LETTER');
    expect(fixture.componentInstance.applicationUploadState(selectedJob, 'COVER_LETTER')).toBeUndefined();
  });

  it('selects or clears every eligible entry independently for each document', () => {
    evidenceEntries = [
      evidenceEntry('50000000-0000-4000-8000-000000000001', 'PROJECT', 'Portfolio', 2),
      evidenceEntry('50000000-0000-4000-8000-000000000002', 'EMPLOYMENT', 'Developer', 3),
      evidenceEntry('50000000-0000-4000-8000-000000000003', 'ACHIEVEMENT', 'Draft award', 1, 'DRAFT'),
    ];
    const fixture = createFixture();

    fixture.componentInstance.openEvidenceSelection(
      fixture.componentInstance.paginatedJobs()[0],
    );
    fixture.componentInstance.toggleAllEvidence('CV');
    fixture.detectChanges();

    expect(fixture.componentInstance.cvEvidenceIds()).toHaveLength(2);
    expect(fixture.componentInstance.coverLetterEvidenceIds()).toEqual([]);
    expect(fixture.componentInstance.cvSectionOrder()).toEqual(['EMPLOYMENT', 'PROJECT']);
    expect(fixture.nativeElement.textContent).toContain('Clear all');
    expect(fixture.nativeElement.textContent).not.toContain('Experience and achievement order');

    fixture.componentInstance.toggleAllEvidence('CV');
    expect(fixture.componentInstance.cvEvidenceIds()).toEqual([]);
    expect(fixture.componentInstance.cvSectionOrder()).toEqual([]);
  });

  it('flags a likely provider preview and requires confirmation of the exact advert text', () => {
    const fixture = createFixture();
    const selectedJob = fixture.componentInstance.paginatedJobs()[0];

    fixture.componentInstance.openEvidenceSelection(selectedJob);
    fixture.detectChanges();

    expect(fixture.componentInstance.generationJobDescription()).toBe('Useful work.');
    expect(fixture.componentInstance.generationJobDescriptionLooksIncomplete()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain(
      'This looks like a shortened search-result preview.',
    );

    const textarea: HTMLTextAreaElement = fixture.debugElement
      .query(By.css('.job-advert-review textarea')).nativeElement;
    textarea.value = `${'Detailed responsibility and requirement. '.repeat(20)}Apply to the named contact.`;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.generationJobDescriptionLooksIncomplete()).toBe(false);
    expect(fixture.componentInstance.generationJobDescriptionConfirmed()).toBe(false);

    const confirmation: HTMLInputElement = fixture.debugElement
      .query(By.css('.job-advert-confirmation input')).nativeElement;
    confirmation.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.generationJobDescriptionConfirmed()).toBe(true);
  });

  it('hydrates a selected provider advert and uses Generate as its confirmation', () => {
    evidenceEntries = [evidenceEntry(
      '50000000-0000-4000-8000-000000000001',
      'PROJECT',
      'Production software project',
      1,
    )];
    const fixture = createFixture();
    const selectedJob: Job = {
      ...fixture.componentInstance.paginatedJobs()[0],
      primarySource: 'REED',
      externalJobId: 'reed-42',
      descriptionCompleteness: JobDescriptionCompletenessEnum.Preview,
    };
    const completeDescription =
      'Complete provider responsibility and requirement. '.repeat(20);
    jobService.getJobDetails.mockReturnValueOnce(of({
      ...selectedJob,
      id: '57152954',
      canonicalJobId: 'reed:57152954',
      description: completeDescription,
      descriptionCompleteness: JobDescriptionCompletenessEnum.Full,
    }));

    fixture.componentInstance.openEvidenceSelection(selectedJob);
    fixture.detectChanges();

    expect(jobService.getJobDetails).toHaveBeenCalledWith(
      'REED',
      'reed-42',
    );
    expect(fixture.componentInstance.generationJobDescription())
      .toBe(completeDescription.trim());
    expect(fixture.componentInstance.generationJobDescriptionNeedsConfirmation())
      .toBe(false);
    expect(fixture.componentInstance.isEvidenceSelectionJob(selectedJob))
      .toBe(true);
    expect(fixture.componentInstance.evidenceSelectionJob()?.id)
      .toBe(selectedJob.id);
    expect(fixture.componentInstance.evidenceSelectionJob()?.canonicalJobId)
      .toBe(selectedJob.canonicalJobId);
    expect(fixture.nativeElement.textContent)
      .toContain('Complete provider advert');
    expect(fixture.debugElement.query(By.css('.job-advert-confirmation')))
      .toBeNull();

    const evidence = fixture.componentInstance.eligibleEvidence()[0];
    fixture.componentInstance.toggleEvidence('CV', evidence);
    fixture.componentInstance.toggleEvidence('COVER_LETTER', evidence);
    expect(fixture.componentInstance.canGenerateFromSelection()).toBe(true);
    fixture.componentInstance.confirmEvidenceGeneration();

    expect(documentGenerationService.generate).toHaveBeenCalledWith(
      expect.objectContaining({descriptionCompleteness: 'FULL'}),
      expect.any(Object),
    );
  });

  it('hydrates a preview card from Read full advert without opening generation', () => {
    const fixture = createFixture();
    const selectedJob: Job = {
      ...fixture.componentInstance.paginatedJobs()[0],
      primarySource: 'REED',
      externalJobId: 'reed-42',
      descriptionCompleteness: JobDescriptionCompletenessEnum.Preview,
    };
    jobService.getJobDetails.mockReturnValueOnce(of({
      ...selectedJob,
      description: 'Complete provider advert with every responsibility.',
      descriptionCompleteness: JobDescriptionCompletenessEnum.Full,
    }));

    fixture.componentInstance.loadFullJobDescription(selectedJob);
    fixture.detectChanges();

    expect(jobService.getJobDetails).toHaveBeenCalledWith('REED', 'reed-42');
    expect(fixture.componentInstance.paginatedJobs()[0].description)
      .toBe('Complete provider advert with every responsibility.');
    expect(fixture.componentInstance.evidenceSelectionJob()).toBeNull();
  });

  it('ranks confirmed evidence against the reviewed advert without selecting it automatically', () => {
    const general = evidenceEntry(
      '50000000-0000-4000-8000-000000000001',
      'VOLUNTEERING',
      'Community support',
      1,
    );
    const software = evidenceEntry(
      '50000000-0000-4000-8000-000000000002',
      'PROJECT',
      'Production API project',
      2,
    );
    software.revisions[0].demonstratedSkills = ['Java', 'Spring Boot'];
    software.revisions[0].description = 'Built and tested REST APIs with Docker.';
    evidenceEntries = [general, software];
    const fixture = createFixture();
    const selectedJob = {
      ...fixture.componentInstance.paginatedJobs()[0],
      description: `${'Build Java and Spring Boot REST APIs with Docker for production. '.repeat(12)}`,
    };

    fixture.componentInstance.openEvidenceSelection(selectedJob);
    fixture.detectChanges();

    expect(fixture.componentInstance.rankedEligibleEvidence()[0].entryId)
      .toBe(software.entryId);
    expect(fixture.componentInstance.evidenceMatch(software).label)
      .toBe('Strong advert match');
    expect(fixture.nativeElement.textContent).toContain('Matched: Java, Spring Boot');
    expect(fixture.componentInstance.cvEvidenceIds()).toEqual([]);
    expect(fixture.componentInstance.coverLetterEvidenceIds()).toEqual([]);
  });

  it('does not present common joining words as advert-match evidence', () => {
    const evidence = evidenceEntry(
      '50000000-0000-4000-8000-000000000001',
      'VOLUNTEERING',
      'Community support',
      1,
    );
    evidence.revisions[0].description = 'The role and our work are for you with the team.';
    evidenceEntries = [evidence];
    const fixture = createFixture();
    const selectedJob = {
      ...fixture.componentInstance.paginatedJobs()[0],
      description: 'The role and our work are for you with the team. '.repeat(15),
    };

    fixture.componentInstance.openEvidenceSelection(selectedJob);

    expect(fixture.componentInstance.evidenceMatch(evidence)).toEqual({
      score: 0,
      label: 'No obvious keyword match',
      explanation: 'Review manually; no distinctive advert terms matched.',
    });
  });

  it('freezes recruiter, unnamed employer and named-contact context with the confirmed advert', () => {
    evidenceEntries = [evidenceEntry(
      '50000000-0000-4000-8000-000000000001',
      'PROJECT',
      'Job Seeker Copilot',
      3,
    )];
    const fixture = createFixture();
    const selectedJob = {
      ...fixture.componentInstance.paginatedJobs()[0],
      company: 'Harnham - Data & Analytics Recruitment',
      companyName: 'Harnham - Data & Analytics Recruitment',
      description: 'Junior Software Engineer full advert. '.repeat(20),
    };

    fixture.componentInstance.openEvidenceSelection(selectedJob);
    const evidence = fixture.componentInstance.eligibleEvidence()[0];
    fixture.componentInstance.toggleEvidence('CV', evidence);
    fixture.componentInstance.toggleEvidence('COVER_LETTER', evidence);
    fixture.componentInstance.generationApplicationContactName.set('Molly Bird');
    confirmGenerationAdvert(fixture);
    fixture.componentInstance.confirmEvidenceGeneration();

    expect(documentGenerationService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        advertiserName: 'Harnham - Data & Analytics Recruitment',
        advertiserType: 'RECRUITER',
        hiringOrganisationName: undefined,
        applicationContactName: 'Molly Bird',
        descriptionCompleteness: 'USER_CONFIRMED',
      }),
      expect.any(Object),
    );
  });

  it('renders one evidence selector inside only the selected job card with exact job context', () => {
    evidenceEntries = [
      evidenceEntry(
        '50000000-0000-4000-8000-000000000001',
        'PROJECT',
        'Portfolio project',
        1,
      ),
    ];
    const fixture = createFixture();
    const selectedJob = fixture.componentInstance.paginatedJobs()[0];

    fixture.componentInstance.openEvidenceSelection(selectedJob);
    fixture.detectChanges();

    const selectors = fixture.debugElement.queryAll(
      By.css('[data-testid="generation-evidence-selector"]'),
    );
    expect(selectors).toHaveLength(1);
    const selectedCard = selectors[0].nativeElement.closest('app-job-card') as HTMLElement;
    expect(selectedCard).not.toBeNull();
    expect(selectedCard.textContent).toContain(selectedJob.title);
    expect(selectedCard.textContent).toContain('Example Ltd');
    expect(selectedCard.textContent).toContain('Reed.co.uk');
    expect(selectedCard.textContent).toContain(selectedJob.id);
    expect(selectedCard.textContent).toContain('CV and cover letter');
    expect(selectedCard.querySelector('[data-testid="generate-documents-button"]')).toBeNull();
    expect(selectors[0].nativeElement.closest('[data-testid="job-results-workspace"]')).not.toBeNull();
  });

  it('keeps only the latest job panel and ignores a stale evidence response', () => {
    const firstResponse = new Subject<any[]>();
    const secondResponse = new Subject<any[]>();
    queuedEvidenceResponses = [firstResponse, secondResponse];
    const fixture = createFixture();
    const [firstJob, secondJob] = fixture.componentInstance.paginatedJobs();

    fixture.componentInstance.openEvidenceSelection(firstJob);
    fixture.componentInstance.openEvidenceSelection(secondJob);
    secondResponse.next([
      evidenceEntry(
        '50000000-0000-4000-8000-000000000002',
        'PROJECT',
        'Current evidence',
        2,
      ),
    ]);
    secondResponse.complete();
    fixture.detectChanges();

    firstResponse.next([
      evidenceEntry(
        '50000000-0000-4000-8000-000000000001',
        'EMPLOYMENT',
        'Stale evidence',
        1,
      ),
    ]);
    firstResponse.complete();
    fixture.detectChanges();

    const selectors = fixture.debugElement.queryAll(
      By.css('[data-testid="generation-evidence-selector"]'),
    );
    expect(selectors).toHaveLength(1);
    expect(selectors[0].nativeElement.closest('app-job-card').textContent)
      .toContain(secondJob.title);
    expect(fixture.componentInstance.evidenceEntries().map(entry =>
      fixture.componentInstance.latestEvidence(entry)?.heading))
      .toEqual(['Current evidence']);
    expect(fixture.nativeElement.textContent).not.toContain('Stale evidence');
  });

  it('cancels while evidence is loading, restores card actions and ignores the late response', () => {
    const pendingEvidence = new Subject<any[]>();
    queuedEvidenceResponses = [pendingEvidence];
    const fixture = createFixture();
    const firstCard = jobCards(fixture)[0];
    firstCard.componentInstance.expanded.set(true);
    fixture.detectChanges();
    const selectedJob = fixture.componentInstance.paginatedJobs()[0];

    fixture.componentInstance.openEvidenceSelection(selectedJob);
    fixture.detectChanges();
    const cancelButton = fixture.debugElement
      .queryAll(By.css('button'))
      .find(button => button.nativeElement.textContent.includes('Cancel'))!;
    expect(cancelButton.nativeElement.disabled).toBe(false);

    cancelButton.nativeElement.click();
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('[data-testid="generation-evidence-selector"]'))).toBeNull();
    expect(firstCard.query(By.css('[data-testid="generate-documents-button"]'))).not.toBeNull();

    pendingEvidence.next([
      evidenceEntry(
        '50000000-0000-4000-8000-000000000001',
        'PROJECT',
        'Late evidence',
        1,
      ),
    ]);
    pendingEvidence.complete();
    fixture.detectChanges();

    expect(fixture.componentInstance.evidenceEntries()).toEqual([]);
    expect(fixture.nativeElement.textContent).not.toContain('Late evidence');
  });

  it('offers a stable retry after evidence loading fails', () => {
    evidenceEntries = [
      evidenceEntry(
        '50000000-0000-4000-8000-000000000001',
        'PROJECT',
        'Recovered evidence',
        1,
      ),
    ];
    queuedEvidenceResponses = [
      throwError(() => new Error('temporary failure')),
      of(evidenceEntries),
    ];
    const fixture = createFixture();

    fixture.componentInstance.openEvidenceSelection(
      fixture.componentInstance.paginatedJobs()[0],
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Your confirmed experience and achievements could not be loaded.',
    );
    clickButtonContaining(fixture, 'Retry loading evidence');

    expect(fixture.componentInstance.eligibleEvidence()).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('Recovered evidence');
    expect(fixture.componentInstance.evidenceLoadError()).toBeNull();
  });

  it('retains a safe per-job draft after synchronous generation failure and clears it on success', () => {
    evidenceEntries = [
      evidenceEntry(
        '50000000-0000-4000-8000-000000000001',
        'PROJECT',
        'Portfolio project',
        1,
      ),
    ];
    documentGenerationService.generate.mockImplementationOnce(() => {
      throw new Error('synchronous client failure');
    });
    const fixture = createFixture();
    const selectedJob = fixture.componentInstance.paginatedJobs()[0];

    fixture.componentInstance.openEvidenceSelection(selectedJob);
    const [project] = fixture.componentInstance.eligibleEvidence();
    fixture.componentInstance.toggleEvidence('CV', project);
    fixture.componentInstance.toggleEvidence('COVER_LETTER', project);
    confirmGenerationAdvert(fixture);

    expect(() => fixture.componentInstance.confirmEvidenceGeneration()).not.toThrow();
    expect(fixture.componentInstance.generatingJobIds().has(selectedJob.id!)).toBe(false);
    expect(fixture.componentInstance.generationErrors()[selectedJob.id!])
      .toBe('Generation failed. Please try again.');

    fixture.componentInstance.openEvidenceSelection(selectedJob);
    confirmGenerationAdvert(fixture);

    expect(fixture.componentInstance.cvEvidenceIds()).toEqual([project.entryId]);
    expect(fixture.componentInstance.coverLetterEvidenceIds()).toEqual([project.entryId]);
    expect(fixture.componentInstance.canGenerateFromSelection()).toBe(true);

    fixture.componentInstance.confirmEvidenceGeneration();

    expect(documentGenerationService.generate).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.evidenceSelectionDrafts()[selectedJob.id!]).toBeUndefined();
  });

  it('reconciles retained drafts against evidence that is still eligible', () => {
    const project = evidenceEntry(
      '50000000-0000-4000-8000-000000000001',
      'PROJECT',
      'Portfolio project',
      2,
    );
    const volunteering = evidenceEntry(
      '50000000-0000-4000-8000-000000000002',
      'VOLUNTEERING',
      'Community volunteer',
      1,
    );
    evidenceEntries = [project, volunteering];
    const fixture = createFixture();
    const selectedJob = fixture.componentInstance.paginatedJobs()[0];

    fixture.componentInstance.openEvidenceSelection(selectedJob);
    const [selectedProject, selectedVolunteering] = fixture.componentInstance.eligibleEvidence();
    fixture.componentInstance.toggleEvidence('CV', selectedProject);
    fixture.componentInstance.toggleEvidence('CV', selectedVolunteering);
    fixture.componentInstance.toggleEvidence('COVER_LETTER', selectedProject);
    fixture.componentInstance.closeEvidenceSelection();

    evidenceEntries = [
      evidenceEntry(
        project.entryId,
        'PROJECT',
        'Portfolio project now needs review',
        3,
        'DRAFT',
      ),
      volunteering,
    ];
    fixture.componentInstance.openEvidenceSelection(selectedJob);

    expect(fixture.componentInstance.cvEvidenceIds()).toEqual([volunteering.entryId]);
    expect(fixture.componentInstance.cvSectionOrder()).toEqual(['VOLUNTEERING']);
    expect(fixture.componentInstance.coverLetterEvidenceIds()).toEqual([]);
    expect(fixture.componentInstance.coverLetterSectionOrder()).toEqual([]);
    expect(fixture.componentInstance.canGenerateFromSelection()).toBe(false);
  });

  it('keeps evidence drafts isolated by canonical job identity', () => {
    evidenceEntries = [
      evidenceEntry(
        '50000000-0000-4000-8000-000000000001',
        'PROJECT',
        'Portfolio project',
        1,
      ),
    ];
    const fixture = createFixture();
    const [firstJob, secondJob] = fixture.componentInstance.paginatedJobs();

    fixture.componentInstance.openEvidenceSelection(firstJob);
    const [project] = fixture.componentInstance.eligibleEvidence();
    fixture.componentInstance.toggleEvidence('CV', project);
    fixture.componentInstance.toggleEvidence('COVER_LETTER', project);
    fixture.componentInstance.openEvidenceSelection(secondJob);

    expect(fixture.componentInstance.cvEvidenceIds()).toEqual([]);
    expect(fixture.componentInstance.coverLetterEvidenceIds()).toEqual([]);

    fixture.componentInstance.openEvidenceSelection(firstJob);

    expect(fixture.componentInstance.cvEvidenceIds()).toEqual([project.entryId]);
    expect(fixture.componentInstance.coverLetterEvidenceIds()).toEqual([project.entryId]);
  });

  it('submits only once when the generate confirmation is activated repeatedly', () => {
    evidenceEntries = [
      evidenceEntry(
        '50000000-0000-4000-8000-000000000001',
        'PROJECT',
        'Portfolio project',
        1,
      ),
    ];
    const generation = new Subject<any>();
    documentGenerationService.generate.mockReturnValueOnce(generation);
    const fixture = createFixture();
    const selectedJob = fixture.componentInstance.paginatedJobs()[0];
    jobCards(fixture)[0].componentInstance.expanded.set(true);
    fixture.detectChanges();

    fixture.componentInstance.openEvidenceSelection(selectedJob);
    const [project] = fixture.componentInstance.eligibleEvidence();
    fixture.componentInstance.toggleEvidence('CV', project);
    fixture.componentInstance.toggleEvidence('COVER_LETTER', project);
    confirmGenerationAdvert(fixture);
    fixture.detectChanges();
    const generateButton: HTMLButtonElement = fixture.debugElement
      .query(By.css('.selector-generate'))
      .nativeElement;

    generateButton.click();
    generateButton.click();
    fixture.detectChanges();

    expect(documentGenerationService.generate).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.generatingJobIds().has(selectedJob.id!)).toBe(true);
    const activeCard = jobCards(fixture)[0];
    expect(activeCard.query(By.css('[data-testid="generate-documents-button"]')).nativeElement.disabled)
      .toBe(true);

    generation.next({
      applicationId: 'application-1',
      cvDocumentId: 'cv-1',
      coverLetterDocumentId: 'cover-1',
      downloads: {},
    });
    generation.complete();
  });

  it('restores one matching pending generation exactly once and applies its authoritative result', () => {
    const generation = new Subject<any>();
    const evidenceId = '50000000-0000-4000-8000-000000000001';
    pendingGenerations = [pendingGeneration('cleaning-1', evidenceId)];
    documentGenerationService.resume.mockReturnValueOnce(generation);
    const fixture = createFixture();

    expect(documentGenerationService.resume).toHaveBeenCalledTimes(1);
    expect(documentGenerationService.resume).toHaveBeenCalledWith('cleaning-1');
    expect(fixture.componentInstance.generatingJobIds().has('cleaning-1')).toBe(true);
    expect(jobCards(fixture)[0].query(
      By.css('[data-testid="generation-progress"]'),
    ).nativeElement.textContent).toContain('Generating');
    expect(jobCards(fixture)[0].query(
      By.css('[data-testid="cancel-generation-button"]'),
    )).not.toBeNull();

    fixture.componentInstance.refresh();
    fixture.detectChanges();

    expect(documentGenerationService.resume).toHaveBeenCalledTimes(1);

    generation.next({
      applicationId: 'application-restored',
      cvDocumentId: 'cv-restored',
      coverLetterDocumentId: 'cover-restored',
      downloads: {cv: {docx: {fileId: 'cv-docx'}}, coverLetter: {}},
    });
    generation.complete();
    fixture.detectChanges();

    const restoredJob = fixture.componentInstance.jobs()
      .find(candidate => fixture.componentInstance.jobStateKey(candidate) === 'cleaning-1');
    expect(restoredJob).toEqual(expect.objectContaining({
      applicationId: 'application-restored',
      applicationStatus: 'DOCUMENTS_GENERATED',
      cvDocumentId: 'cv-restored',
      coverLetterDocumentId: 'cover-restored',
    }));
    expect(fixture.componentInstance.generationDownloads()['cleaning-1']?.cv?.docx?.fileId)
      .toBe('cv-docx');
    expect(fixture.componentInstance.generatingJobIds().has('cleaning-1')).toBe(false);
  });

  it('does not let an older in-flight search overwrite authoritative generation completion', () => {
    const generation = new Subject<any>();
    const staleSearch = new Subject<JobSearchResponse>();
    const evidenceId = '50000000-0000-4000-8000-000000000001';
    evidenceEntries = [
      evidenceEntry(evidenceId, 'PROJECT', 'Portfolio project', 1),
    ];
    documentGenerationService.generate.mockReturnValueOnce(generation);
    const fixture = createFixture();
    const selectedJob = fixture.componentInstance.paginatedJobs()[0];

    fixture.componentInstance.openEvidenceSelection(selectedJob);
    const [project] = fixture.componentInstance.eligibleEvidence();
    fixture.componentInstance.toggleEvidence('CV', project);
    fixture.componentInstance.toggleEvidence('COVER_LETTER', project);
    confirmGenerationAdvert(fixture);
    expect(fixture.componentInstance.canGenerateFromSelection()).toBe(true);
    fixture.componentInstance.confirmEvidenceGeneration();

    queuedSearchResponses = [staleSearch];
    fixture.componentInstance.refresh();

    generation.next({
      applicationId: 'application-authoritative',
      cvDocumentId: 'cv-authoritative',
      coverLetterDocumentId: 'cover-authoritative',
      downloads: {cv: {}, coverLetter: {}},
    });
    generation.complete();
    staleSearch.next(rolePageResponse(
      'cleaning',
      jobsFor('cleaning', 10),
      12,
      1,
      2,
    ));
    staleSearch.complete();
    fixture.detectChanges();

    expect(fixture.componentInstance.jobs().find(candidate =>
      fixture.componentInstance.jobStateKey(candidate) === 'cleaning-1'))
      .toEqual(expect.objectContaining({
        applicationId: 'application-authoritative',
        applicationStatus: 'DOCUMENTS_GENERATED',
        cvDocumentId: 'cv-authoritative',
        coverLetterDocumentId: 'cover-authoritative',
      }));
    expect(fixture.componentInstance.generationDownloads()['cleaning-1'])
      .toEqual({cv: {}, coverLetter: {}});
  });

  it('restores owner-scoped pending generation without legacy token inputs', () => {
    const generation = new Subject<any>();
    const evidenceId = '50000000-0000-4000-8000-000000000001';
    pendingGenerations = [pendingGeneration('cleaning-1', evidenceId)];
    documentGenerationService.resume.mockReturnValueOnce(generation);

    const fixture = createFixture('FIXTURE', false);

    expect(documentGenerationService.resume).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.generatingJobIds().has('cleaning-1')).toBe(true);
    fixture.destroy();
  });

  it('keeps restored evidence available for retry after an actionable generation error', () => {
    const generation = new Subject<any>();
    const evidenceId = '50000000-0000-4000-8000-000000000001';
    evidenceEntries = [
      evidenceEntry(evidenceId, 'PROJECT', 'Portfolio project', 1),
    ];
    pendingGenerations = [pendingGeneration('cleaning-1', evidenceId)];
    documentGenerationService.resume.mockReturnValueOnce(generation);
    const fixture = createFixture();

    generation.error(new DocumentGenerationError(
      'EVIDENCE_CHANGED',
      'One of the selected entries changed. Review and confirm your evidence before retrying.',
    ));
    fixture.detectChanges();

    expect(fixture.componentInstance.generatingJobIds().has('cleaning-1')).toBe(false);
    expect(fixture.componentInstance.generationErrors()['cleaning-1'])
      .toContain('selected entries changed');

    const selectedJob = fixture.componentInstance.jobs()
      .find(candidate => fixture.componentInstance.jobStateKey(candidate) === 'cleaning-1')!;
    fixture.componentInstance.openEvidenceSelection(selectedJob);
    fixture.detectChanges();

    expect(fixture.componentInstance.cvEvidenceIds()).toEqual([evidenceId]);
    expect(fixture.componentInstance.coverLetterEvidenceIds()).toEqual([evidenceId]);
    expect(fixture.componentInstance.canGenerateFromSelection()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Review the job advert');
  });

  it('cancels a restored generation, keeps its evidence draft and restores job-card actions', () => {
    const generation = new Subject<any>();
    const evidenceId = '50000000-0000-4000-8000-000000000001';
    pendingGenerations = [pendingGeneration('cleaning-1', evidenceId)];
    documentGenerationService.resume.mockReturnValueOnce(generation);
    documentGenerationService.cancel.mockImplementationOnce(() => new Observable(observer => {
      generation.complete();
      observer.next(undefined);
      observer.complete();
    }));
    const fixture = createFixture();
    const card = jobCards(fixture)[0];
    const cancelButton: HTMLButtonElement = card
      .query(By.css('[data-testid="cancel-generation-button"]'))
      .nativeElement;

    cancelButton.click();
    fixture.detectChanges();

    expect(documentGenerationService.cancel).toHaveBeenCalledTimes(1);
    expect(documentGenerationService.cancel).toHaveBeenCalledWith('cleaning-1');
    expect(generation.observed).toBe(false);
    expect(fixture.componentInstance.generatingJobIds().has('cleaning-1')).toBe(false);
    expect(fixture.componentInstance.evidenceSelectionDrafts()['cleaning-1'])
      .toEqual(expect.objectContaining({
        cvEvidenceIds: [evidenceId],
        coverLetterEvidenceIds: [evidenceId],
      }));
    expect(fixture.componentInstance.generationMessages()['cleaning-1'])
      .toContain('Generation cancelled');
    expect(fixture.componentInstance.generationErrors()['cleaning-1']).toBeUndefined();

    card.componentInstance.expanded.set(true);
    fixture.detectChanges();

    expect(card.query(By.css('[data-testid="generate-documents-button"]'))).not.toBeNull();
    expect(card.query(By.css('[data-testid="cancel-generation-button"]'))).toBeNull();
  });

  it('unsubscribes restored generation observers when the results component is destroyed', () => {
    const generation = new Subject<any>();
    const evidenceId = '50000000-0000-4000-8000-000000000001';
    pendingGenerations = [pendingGeneration('cleaning-1', evidenceId)];
    documentGenerationService.resume.mockReturnValueOnce(generation);
    const fixture = createFixture();

    expect(generation.observed).toBe(true);

    fixture.destroy();

    expect(generation.observed).toBe(false);
  });

  it('retains the current application and documents when withdrawal requires recovery', () => {
    currentResponse = singleRoleResponse([
      job('generated role', {
        id: 'generated-role',
        canonicalJobId: 'canonical-generated-role',
        applicationId: 'application-generated-role',
        applicationStatus: 'DOCUMENTS_GENERATED',
        cvDocumentId: 'cv-current',
        coverLetterDocumentId: 'cover-current',
      }),
    ], 'cleaning');
    applicationTracker.withdrawGeneratedApplication.mockReturnValueOnce(of({
      processing: true,
      withdrawn: false,
      retryable: true,
      recoveryCode: 'RECOVERY_REQUIRED',
    }));
    const fixture = createFixture();
    const notifications: {message: string; type: string}[] = [];
    let applicationChanges = 0;
    fixture.componentInstance.notify.subscribe(event => notifications.push(event));
    fixture.componentInstance.applicationChanged.subscribe(() => applicationChanges++);
    const generatedJob = fixture.componentInstance.jobs()[0];

    fixture.componentInstance.withdrawGeneratedApplication(generatedJob);
    fixture.detectChanges();

    expect(fixture.componentInstance.jobs()[0]).toEqual(expect.objectContaining({
      applicationId: 'application-generated-role',
      applicationStatus: 'DOCUMENTS_GENERATED',
      cvDocumentId: 'cv-current',
      coverLetterDocumentId: 'cover-current',
    }));
    expect(fixture.componentInstance.updatingApplicationStatuses()['canonical-generated-role'])
      .toBeUndefined();
    expect(fixture.componentInstance.generationMessages()['canonical-generated-role'])
      .toContain('retained');
    expect(notifications.at(-1)).toEqual(expect.objectContaining({
      type: 'info',
      message: expect.stringContaining('try again'),
    }));
    expect(applicationChanges).toBe(1);
  });

  it('retains current downloads when document replacement requires recovery', async () => {
    currentResponse = singleRoleResponse([
      job('generated role', {
        id: 'generated-role',
        canonicalJobId: 'canonical-generated-role',
        applicationId: 'application-generated-role',
        applicationStatus: 'DOCUMENTS_GENERATED',
        cvDocumentId: 'cv-current',
        coverLetterDocumentId: 'cover-current',
      }),
    ], 'cleaning');
    documentGenerationService.uploadReplacement.mockResolvedValueOnce({
      processing: true,
      retryable: true,
      recoveryCode: 'RECOVERY_REQUIRED',
    });
    const fixture = createFixture();
    const currentDownloads = {
      cv: {docx: {fileId: 'cv-current-docx'}},
      coverLetter: {docx: {fileId: 'cover-current-docx'}},
    };
    fixture.componentInstance.generationDownloads.set({
      'canonical-generated-role': currentDownloads,
    });
    const generatedJob = fixture.componentInstance.jobs()[0];
    const notifications: {message: string; type: string}[] = [];
    fixture.componentInstance.notify.subscribe(event => notifications.push(event));

    fixture.componentInstance.uploadReplacement(generatedJob, {
      applicationId: 'application-generated-role',
      documentKind: 'CV',
      file: new File(
        ['replacement'],
        'replacement.docx',
        {type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},
      ),
    });
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.componentInstance.generationDownloads()['canonical-generated-role'])
      .toBe(currentDownloads);
    expect(fixture.componentInstance.jobs()[0]).toEqual(expect.objectContaining({
      cvDocumentId: 'cv-current',
      coverLetterDocumentId: 'cover-current',
    }));
    expect(notifications.at(-1)).toEqual(expect.objectContaining({
      type: 'info',
      message: expect.stringContaining('retained'),
    }));
  });

  it('keeps description expansion independent for each canonical job card', () => {
    const firstTail = 'FIRST DESCRIPTION TAIL';
    const secondTail = 'SECOND DESCRIPTION TAIL';
    currentResponse = singleRoleResponse([
      job('first long role', {
        id: 'first-long-role',
        canonicalJobId: 'canonical-first',
        description: `${'First role requirement '.repeat(30)}${firstTail}`,
      }),
      job('second long role', {
        id: 'second-long-role',
        canonicalJobId: 'canonical-second',
        description: `${'Second role requirement '.repeat(30)}${secondTail}`,
      }),
    ], 'cleaning');
    const fixture = createFixture();
    const cards = jobCards(fixture);
    cards.forEach(card => card.componentInstance.expanded.set(true));
    fixture.detectChanges();

    cards[0].query(By.css('.description-toggle')).nativeElement.click();
    fixture.detectChanges();

    expect(cards[0].query(By.css('.job-description')).nativeElement.textContent)
      .toContain(firstTail);
    expect(cards[1].query(By.css('.job-description')).nativeElement.textContent)
      .not.toContain(secondTail);
    expect(cards[0].componentInstance.descriptionExpanded()).toBe(true);
    expect(cards[1].componentInstance.descriptionExpanded()).toBe(false);
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
    confirmGenerationAdvert(fixture);
    expect(fixture.componentInstance.canGenerateFromSelection()).toBe(true);
    fixture.componentInstance.confirmEvidenceGeneration();
    fixture.detectChanges();

    expect(fixture.componentInstance.generationErrors()[selectedJob.id!])
      .toBe('Insufficient AI Credit for this job. No OpenAI request was made.');
  });

  function createFixture(
    providerMode: 'FIXTURE' | 'REAL_PROVIDERS' | 'REQUIRED_VALIDATION' = 'FIXTURE',
    bindLegacyAuthInputs = true,
  ) {
    const fixture = TestBed.createComponent(JobResultsComponent);
    if (bindLegacyAuthInputs) {
      fixture.componentRef.setInput('authToken', 'token');
      fixture.componentRef.setInput('userId', 'user-1');
    }
    fixture.componentRef.setInput('aspirations', 'cleaning, programming');
    fixture.componentRef.setInput('workPrefs', JSON.stringify({ postcode: 'SW1A 1AA', hours: 'full time' }));
    fixture.componentRef.setInput('providerMode', providerMode);
    fixture.componentRef.setInput('applicationToolsAvailable', true);
    fixture.componentRef.setInput('applicationTrackingAvailable', true);
    fixture.detectChanges();
    return fixture;
  }

  function confirmGenerationAdvert(
    fixture: {componentInstance: JobResultsComponent},
  ): void {
    fixture.componentInstance.generationJobDescription.set(
      `${'Build and launch production software with a collaborative product team. '.repeat(10)}`
      + 'Required skills include supported technologies and clear problem solving.',
    );
    fixture.componentInstance.generationJobDescriptionConfirmed.set(true);
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

  function pendingGeneration(
    canonicalJobId: string,
    evidenceId: string,
  ): PendingDocumentGeneration {
    return {
      canonicalJobId,
      operationId: '70000000-0000-4000-8000-000000000001',
      state: 'PROCESSING',
      startedAt: Date.now(),
      evidence: {
        cv: {
          entryIds: [evidenceId],
          sectionOrder: [DocumentEvidenceSelectionSectionOrderEnum.Project],
        },
        coverLetter: {
          entryIds: [evidenceId],
          sectionOrder: [DocumentEvidenceSelectionSectionOrderEnum.Project],
        },
      },
    };
  }
});
