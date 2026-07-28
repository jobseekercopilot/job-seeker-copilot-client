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
});
