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
  const withdrawGeneratedApplication = vi.fn(() => of({
    status: 200,
    body: {withdrawn: true},
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
            withdrawGeneratedApplication,
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

  it('preserves the authoritative canonical identity, provenance and version when listing applications', () => {
    getApplications.mockReturnValueOnce(of([{
      id: '00000000-0000-0000-0000-000000000001',
      jobId: 'legacy-job-1',
      canonicalJobId: 'canonical-job-1',
      provider: 'REED',
      externalJobId: 'reed-1',
      provenance: 'JOB_SEARCH',
      status: 'DOCUMENTS_GENERATED',
      version: 7,
    }]));

    TestBed.inject(ApplicationTrackerService).listApplications().subscribe(applications => {
      expect(applications).toEqual([expect.objectContaining({
        id: '00000000-0000-0000-0000-000000000001',
        applicationId: '00000000-0000-0000-0000-000000000001',
        jobId: 'legacy-job-1',
        canonicalJobId: 'canonical-job-1',
        provenance: 'JOB_SEARCH',
        version: 7,
      })]);
    });
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

  it('describes a newly saved application without inventing generated documents', () => {
    const service = TestBed.inject(ApplicationTrackerService);
    const [event] = service.eventsForApplication({
      id: '00000000-0000-0000-0000-000000000001',
      status: 'SAVED',
      jobTitle: 'Platform Engineer',
      companyName: 'Example Ltd',
      createdAt: '2026-07-29T15:00:00Z',
    });

    expect(event.eventType).toBe('SAVED');
    expect(event.label).toBe('Saved to applications');
    expect(service.journalPreview([event])).toContain(
      'Saved Platform Engineer at Example Ltd to applications.',
    );
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

  it('reports an accepted withdrawal as processing rather than completed', () => {
    withdrawGeneratedApplication.mockReturnValueOnce(of({
      status: 202,
      body: {
        withdrawn: false,
        operationId: '00000000-0000-0000-0000-000000000002',
        operationStatus: 'PROCESSING',
      },
    }));

    TestBed.inject(ApplicationTrackerService)
      .withdrawGeneratedApplication('00000000-0000-0000-0000-000000000001')
      .subscribe(outcome => expect(outcome.processing).toBe(true));

    expect(withdrawGeneratedApplication).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      'response',
      false,
      {transferCache: false},
    );
  });
});
