import {
  latestUserUploadTimestamp,
  MyApplicationsComponent,
} from './my-applications.component';
import { TrackedApplication } from '../../services/application-tracker.service';

describe('MyApplicationsComponent document replacement', () => {
  const component = Object.create(MyApplicationsComponent.prototype) as MyApplicationsComponent;

  const application = (status: string, applicationId = 'application-1') => ({
    applicationId,
    status,
  } as TrackedApplication);

  it('allows document replacement before the application is marked applied', () => {
    expect(component.canUploadDocuments(application('DOCUMENTS_GENERATED'))).toBe(true);
  });

  it.each([
    'APPLIED',
    'INTERVIEW',
    'OFFER',
    'ACCEPTED',
    'UNSUCCESSFUL',
    'WITHDRAWN',
  ])('locks document replacement after the generated-document stage (%s)', status => {
    expect(component.canUploadDocuments(application(status))).toBe(false);
  });

  it('requires a persisted application identifier', () => {
    expect(component.canUploadDocuments(application('DOCUMENTS_GENERATED', ''))).toBe(false);
  });

  it('derives the uploaded milestone from durable user-uploaded metadata', () => {
    expect(latestUserUploadTimestamp([
      {
        source: 'SYSTEM_GENERATED',
        createdAt: '2026-07-28T08:00:00Z',
      },
      {
        source: 'USER_UPLOADED',
        createdAt: '2026-07-28T09:00:00Z',
      },
      {
        source: 'USER_UPLOADED',
        updatedAt: '2026-07-28T10:00:00Z',
      },
    ])).toBe('2026-07-28T10:00:00Z');
  });

  it('does not invent an upload milestone for generated-only documents', () => {
    expect(latestUserUploadTimestamp([
      {
        source: 'SYSTEM_GENERATED',
        createdAt: '2026-07-28T08:00:00Z',
      },
      {
        source: 'SYSTEM_GENERATED',
        createdAt: '2026-07-28T08:01:00Z',
      },
    ])).toBeUndefined();
  });

  it('exposes only safe persisted source links in the application view', () => {
    const persisted = {
      listingUrl: 'https://www.jobs.nhs.uk/candidate/jobadvert/C123',
      applyUrl: 'https://www.jobs.nhs.uk/candidate/jobadvert/C123',
      attributionSourceUrl: 'https://www.jobs.nhs.uk/',
      licenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
    } as TrackedApplication;

    expect(component.listingUrl(persisted))
      .toBe('https://www.jobs.nhs.uk/candidate/jobadvert/C123');
    expect(component.applyUrl(persisted))
      .toBe('https://www.jobs.nhs.uk/candidate/jobadvert/C123');
    expect(component.attributionSourceUrl(persisted))
      .toBe('https://www.jobs.nhs.uk/');
    expect(component.licenceUrl(persisted))
      .toBe('https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/');
  });

  it('does not render an unsafe persisted source URL', () => {
    const persisted = {
      listingUrl: 'javascript:alert(1)',
      applyUrl: 'data:text/html,unsafe',
    } as TrackedApplication;

    expect(component.listingUrl(persisted)).toBeNull();
    expect(component.applyUrl(persisted)).toBeNull();
  });
});
