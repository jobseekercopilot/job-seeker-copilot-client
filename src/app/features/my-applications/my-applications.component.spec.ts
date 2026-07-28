import { MyApplicationsComponent } from './my-applications.component';
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
});
