import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of, throwError } from 'rxjs';
import { JobResultsComponent } from './job-results.component';
import { JobService } from '../../services/job.service';
import { DocumentGenerationService } from '../../services/document-generation.service';
import { Job, JobSearchResponse } from '../../models/job-search.model';
import { ProviderResultStatusStatusEnum } from '../../api/job-finder';
import { DocumentEvidenceSelectionSectionOrderEnum } from '../../api/document-generation-gateway';
import { ApplicationTrackerService, TrackedApplication } from '../../services/application-tracker.service';
import { EvidenceLibraryService } from '../../api';

describe('JobResultsComponent', () => {
  const response: JobSearchResponse = {
    resultsByTargetRole: [
      { targetRole: 'cleaning', jobs: jobsFor('cleaning', 12) },
      { targetRole: 'programming', jobs: jobsFor('programming', 16) },
    ],
    totalResults: 28,
  };
  let currentResponse = response;
  let searchErrorStatus: number | undefined;
  let trackedApplications: TrackedApplication[] = [];
  let evidenceEntries: any[] = [];

  const jobService = {
    callCount: 0,
    searchJobs: () => {
      jobService.callCount++;
      if (searchErrorStatus != null) {
        return throwError(() => ({status: searchErrorStatus}));
      }
      return of(currentResponse);
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
    listApplications: () => of(trackedApplications),
  };
  const evidenceLibrary = {
    listEvidence: () => of(evidenceEntries),
  };

  beforeEach(async () => {
    jobService.callCount = 0;
    currentResponse = response;
    searchErrorStatus = undefined;
    trackedApplications = [];
    evidenceEntries = [];
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

  it('shows target role tabs with counts', () => {
    const fixture = createFixture();

    expect(fixture.nativeElement.textContent).toContain('cleaning');
    expect(fixture.nativeElement.textContent).toContain('(12)');
    expect(fixture.nativeElement.textContent).toContain('programming');
    expect(fixture.nativeElement.textContent).toContain('(16)');
  });

  it('shows jobs for the selected target role', () => {
    const fixture = createFixture();

    expect(fixture.nativeElement.textContent).toContain('cleaning job 1');
    expect(fixture.nativeElement.textContent).not.toContain('programming job 1');

    clickButtonContaining(fixture, 'programming');

    expect(fixture.nativeElement.textContent).toContain('programming job 1');
    expect(fixture.nativeElement.textContent).not.toContain('cleaning job 1');
  });

  it('clears stale matches when a refreshed search is rejected', () => {
    const fixture = createFixture();
    expect(jobCards(fixture)).toHaveLength(10);

    searchErrorStatus = 400;
    fixture.componentInstance.refresh();
    fixture.detectChanges();

    expect(fixture.componentInstance.jobs()).toEqual([]);
    expect(fixture.componentInstance.roleResults()).toEqual([]);
    expect(fixture.componentInstance.totalResults()).toBe(0);
    expect(fixture.componentInstance.error())
      .toBe('Invalid search parameters. Please update your profile and try again.');
    expect(jobCards(fixture)).toHaveLength(0);
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

  it('resets to page 1 when changing target role', () => {
    const fixture = createFixture();
    clickButtonContaining(fixture, 'Next');

    expect(fixture.nativeElement.textContent).toContain('Page 2 of 2');

    clickButtonContaining(fixture, 'programming');

    expect(fixture.nativeElement.textContent).toContain('programming job 1');
    expect(fixture.nativeElement.textContent).toContain('Page 1 of 2');
  });

  it('applies source filter before sorting and paginating', () => {
    currentResponse = {
      resultsByTargetRole: [
        {
          targetRole: 'developer',
          jobs: [
            ...jobsFor('adzuna', 12, 'Adzuna').map((job, index) => ({
              ...job,
              salary: { min: 20000 + index * 1000, max: 30000 + index * 1000, currency: 'GBP', normalisedAnnualMidpoint: 30000 + index * 1000 }
            })),
            ...jobsFor('reed', 4, 'Reed.co.uk').map((job, index) => ({
              ...job,
              salary: { min: 90000 + index * 1000, max: 100000 + index * 1000, currency: 'GBP', normalisedAnnualMidpoint: 100000 + index * 1000 }
            }))
          ]
        }
      ],
      totalResults: 16,
    };
    const fixture = createFixture();

    clickButtonContaining(fixture, 'Filter');
    clickButtonContaining(fixture, 'Adzuna');
    fixture.componentInstance.selectSort('HIGHEST_SALARY');
    fixture.detectChanges();

    expect(jobCards(fixture)).toHaveLength(10);
    expect(fixture.nativeElement.textContent).toContain('Showing 1-10 of 12 matches');
    expect(fixture.nativeElement.textContent).toContain('adzuna job 12');
    expect(fixture.nativeElement.textContent).not.toContain('reed job 1');
    expect(fixture.nativeElement.textContent).toContain('Page 1 of 2');

    clickButtonContaining(fixture, 'Next');

    expect(jobCards(fixture)).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('adzuna job 2');
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
    currentResponse = {
      ...singleRoleResponse([job('real developer role', {})]),
      providerResults: [
        {provider: 'REED', status: ProviderResultStatusStatusEnum.Success, rawResultCount: 1},
        {provider: 'JSEARCH', status: ProviderResultStatusStatusEnum.RateLimited, rawResultCount: 0},
      ],
    };
    const fixture = createFixture('REAL_PROVIDERS');

    expect(fixture.nativeElement.textContent).toContain('Real providers — partial availability');
    expect(fixture.nativeElement.textContent).toContain('real developer role');
    expect(fixture.nativeElement.textContent).toContain('JSEARCH has reached its current request limit');
  });

  it('distinguishes a real-provider configuration error from zero results', () => {
    currentResponse = {
      ...singleRoleResponse([]),
      providerResults: [
        {provider: 'REED', status: ProviderResultStatusStatusEnum.ConfigurationError, rawResultCount: 0},
      ],
    };
    const fixture = createFixture('REAL_PROVIDERS');

    expect(fixture.nativeElement.textContent).toContain('Real-provider configuration error');
    expect(fixture.nativeElement.textContent)
      .toContain('Real-provider configuration is incomplete. No fixture results were substituted.');
  });

  it('distinguishes unavailable real providers from a successful zero-result search', () => {
    currentResponse = {
      ...singleRoleResponse([]),
      providerResults: [
        {provider: 'ADZUNA', status: ProviderResultStatusStatusEnum.Unavailable, rawResultCount: 0},
      ],
    };
    const unavailable = createFixture('REAL_PROVIDERS');
    expect(unavailable.nativeElement.textContent).toContain('Real providers temporarily unavailable');
    expect(unavailable.nativeElement.textContent)
      .toContain('Real job providers are temporarily unavailable. Please try again later.');

    currentResponse = {
      ...singleRoleResponse([]),
      providerResults: [
        {provider: 'ADZUNA', status: ProviderResultStatusStatusEnum.Success, rawResultCount: 0},
      ],
    };
    const zeroResults = createFixture('REAL_PROVIDERS');
    expect(zeroResults.nativeElement.textContent).toContain('Real providers');
    expect(zeroResults.nativeElement.textContent)
      .toContain('No job matches found based on your current profile.');
  });

  it('rehydrates a generated application into matching search results after reload', () => {
    currentResponse = singleRoleResponse([
      job('persisted role', {
        id: 'canonical-job-1',
        canonicalJobId: 'canonical-job-1',
        primarySource: 'REED',
        externalJobId: 'reed-123',
      }),
    ]);
    trackedApplications = [{
      id: 'application-1',
      applicationId: 'application-1',
      jobId: 'canonical-job-1',
      status: 'DOCUMENTS_GENERATED',
      cvDocumentId: 'cv-1',
      coverLetterDocumentId: 'letter-1',
      updatedAt: '2026-07-28T09:04:00Z',
    }];

    const fixture = createFixture();
    fixture.debugElement.query(By.css('.job-main-toggle')).nativeElement.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('DOCUMENTS_GENERATED');
    expect(fixture.nativeElement.textContent).not.toContain('Generate CV & Cover Letter');
    expect(fixture.nativeElement.textContent).toContain('Upload CV');
  });

  it('does not reconcile an external id from a different provider', () => {
    currentResponse = singleRoleResponse([
      job('untracked role', {primarySource: 'REED', externalJobId: 'shared-123'}),
    ]);
    trackedApplications = [{
      id: 'application-1',
      jobId: 'different-canonical-job',
      provider: 'ADZUNA',
      externalJobId: 'shared-123',
      status: 'DOCUMENTS_GENERATED',
    }];

    const fixture = createFixture();
    fixture.debugElement.query(By.css('.job-main-toggle')).nativeElement.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Generate CV & Cover Letter');
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

  function singleRoleResponse(jobs: Job[]): JobSearchResponse {
    return {
      resultsByTargetRole: [{ targetRole: 'developer', jobs }],
      totalResults: jobs.length,
    };
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
