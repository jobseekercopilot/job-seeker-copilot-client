import {TestBed} from '@angular/core/testing';
import {of} from 'rxjs';
import {
  ApplicationRecordResponse,
  JobApplicationsService,
  UpdateApplicationStatusRequestStatusEnum,
} from '../api/job-finder';
import type {Job} from '../models/job-search.model';
import {ApplicationTrackerService} from './application-tracker.service';
import {BrowserSessionService} from './browser-session.service';

describe('ApplicationTrackerService', () => {
  const ensureCsrf = vi.fn(() => of(undefined));
  const getApplications = vi.fn(() => of([] as ApplicationRecordResponse[]));
  const createApplication = vi.fn(() => of({
    id: '00000000-0000-0000-0000-000000000001',
    status: 'APPLIED',
  }));
  const updateApplicationStatus = vi.fn(() => of({
    id: '00000000-0000-0000-0000-000000000001',
    status: 'INTERVIEW',
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        ApplicationTrackerService,
        {
          provide: JobApplicationsService,
          useValue: {
            getApplications,
            createApplication,
            updateApplicationStatus,
          },
        },
        {provide: BrowserSessionService, useValue: {ensureCsrf}},
      ],
    });
  });

  it('lists applications without a browser-selected owner', () => {
    TestBed.inject(ApplicationTrackerService).listApplications().subscribe();

    expect(getApplications).toHaveBeenCalledWith(
      'body',
      false,
      {transferCache: false},
    );
  });

  it('creates an application from job provenance without user identity', () => {
    const job: Job = {
      id: 'canonical-1',
      canonicalJobId: 'canonical-1',
      primarySource: 'REED',
      externalJobId: 'reed-1',
      title: 'Platform Engineer',
      company: 'Example Ltd',
      location: 'Reading',
    };

    TestBed.inject(ApplicationTrackerService)
      .createApplication(job)
      .subscribe();

    expect(ensureCsrf).toHaveBeenCalledOnce();
    expect(createApplication).toHaveBeenCalledWith(
      {
        jobId: 'canonical-1',
        canonicalJobId: 'canonical-1',
        provider: 'REED',
        externalJobId: 'reed-1',
        jobTitle: 'Platform Engineer',
        companyName: 'Example Ltd',
        location: 'Reading',
      },
      'body',
      false,
      {transferCache: false},
    );
  });

  it('preserves authoritative NHS source metadata from the matching search source', () => {
    const job: Job = {
      id: 'canonical-nhs-c123',
      canonicalJobId: 'canonical-nhs-c123',
      primarySource: 'NHS_JOBS',
      externalJobId: 'C123',
      title: 'Community Staff Nurse',
      company: 'Example NHS Trust',
      location: 'London',
      sources: [{
        integrationProvider: 'NHS_JOBS',
        provider: 'NHS Jobs',
        externalJobId: 'C123',
        listingUrl: 'https://www.jobs.nhs.uk/candidate/jobadvert/C123',
        applyUrl: 'https://www.jobs.nhs.uk/candidate/jobadvert/C123',
        attributionLabel: 'Vacancy source: NHS Jobs',
        attributionSourceUrl: 'https://www.jobs.nhs.uk/',
        licenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
        disclaimer: 'NHS Jobs does not endorse Job Seeker Copilot.',
      }],
    };

    TestBed.inject(ApplicationTrackerService)
      .createApplication(job)
      .subscribe();

    expect(createApplication).toHaveBeenCalledWith(
      {
        jobId: 'canonical-nhs-c123',
        canonicalJobId: 'canonical-nhs-c123',
        provider: 'NHS_JOBS',
        externalJobId: 'C123',
        listingUrl: 'https://www.jobs.nhs.uk/candidate/jobadvert/C123',
        applyUrl: 'https://www.jobs.nhs.uk/candidate/jobadvert/C123',
        attributionLabel: 'Vacancy source: NHS Jobs',
        attributionSourceUrl: 'https://www.jobs.nhs.uk/',
        licenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
        disclaimer: 'NHS Jobs does not endorse Job Seeker Copilot.',
        jobTitle: 'Community Staff Nurse',
        companyName: 'Example NHS Trust',
        location: 'London',
      },
      'body',
      false,
      {transferCache: false},
    );
  });

  it('retains a tracker-owned canonical identity after reload', () => {
    getApplications.mockReturnValueOnce(of([{
      id: '00000000-0000-0000-0000-000000000001',
      jobId: 'legacy-job-id',
      canonicalJobId: 'canonical-nhs-c123',
    }]));

    TestBed.inject(ApplicationTrackerService).listApplications().subscribe(applications => {
      expect(applications[0].canonicalJobId).toBe('canonical-nhs-c123');
    });
  });

  it('bootstraps CSRF before changing an application status', () => {
    TestBed.inject(ApplicationTrackerService)
      .updateStatus(
        '00000000-0000-0000-0000-000000000001',
        UpdateApplicationStatusRequestStatusEnum.Interview,
      )
      .subscribe();

    expect(ensureCsrf).toHaveBeenCalledOnce();
    expect(updateApplicationStatus).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      {status: 'INTERVIEW'},
      'body',
      false,
      {transferCache: false},
    );
  });
});
