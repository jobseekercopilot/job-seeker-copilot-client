import {
  isReviewedLegalConfiguration,
  type PublicLegalConfiguration,
} from './runtime-configuration.service';

describe('reviewed legal runtime configuration', () => {
  const reviewed: PublicLegalConfiguration = {
    ready: true,
    status: 'REVIEWED',
    minimumUserAge: 18,
    legalEntityType: 'SOLE_TRADER',
    taxStatus: 'NOT_VAT_REGISTERED',
    effectiveDate: '2026-09-01',
    version: 'beta-1',
    controllerName: 'Northstar Career Services',
    tradingName: 'Job Seeker Copilot',
    businessAddress: '10 High Street, London, SW1A 1AA',
    privacyEmail: 'privacy@jobseekercopilot.com',
    supportEmail: 'support@jobseekercopilot.com',
    icoRegistrationStatus: 'NOT_REQUIRED_CONFIRMED',
    accountDeletionCompletionDays: 30,
    documentDeletionCompletionDays: 30,
    securityLogRetentionDays: 30,
    supportRecordRetentionDays: 365,
    financialRecordRetentionYears: 6,
  };

  it('accepts a complete reviewed configuration', () => {
    expect(isReviewedLegalConfiguration(reviewed)).toBe(true);
  });

  it('rejects impossible dates and identity placeholders', () => {
    expect(isReviewedLegalConfiguration({...reviewed, effectiveDate: '2026-09-31'}))
      .toBe(false);
    expect(isReviewedLegalConfiguration({...reviewed, controllerName: 'TBD'}))
      .toBe(false);
    expect(isReviewedLegalConfiguration({...reviewed, businessAddress: 'Address supplied at release'}))
      .toBe(false);
  });
});
