import {TestBed} from '@angular/core/testing';
import type {PublicLegalConfiguration} from '../../services/runtime-configuration.service';
import {LegalNoticeComponent} from './legal-notice';

describe('LegalNoticeComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({imports: [LegalNoticeComponent]}).compileComponents();
  });

  it('publishes a complete draft privacy notice without inventing legal identity or dates', () => {
    const fixture = TestBed.createComponent(LegalNoticeComponent);
    fixture.componentRef.setInput('mode', 'privacy');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Privacy Policy');
    expect(text).toContain('Draft for legal review — not yet effective');
    expect(text).toContain('Information we process');
    expect(text).toContain('lawful bases');
    expect(text).toContain('Retention, deletion and export');
    expect(text).toContain('Job Seeker Copilot does not make hiring decisions');
    expect(text).toContain('UK residents aged 18 or over');
    expect(text).not.toContain('under 16');
    expect(text).toContain('origin and destination coordinates');
    expect(fixture.nativeElement.querySelector('a[href="https://policies.google.com/privacy"]'))
      .not.toBeNull();
  });

  it('defines exact document-credit, refund and statutory-right principles', () => {
    const fixture = TestBed.createComponent(LegalNoticeComponent);
    fixture.componentRef.setInput('mode', 'terms');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Terms of Use');
    expect(text).toContain('One document credit covers one successfully delivered tailored CV');
    expect(text).toContain('do not renew automatically');
    expect(text).toContain('14-day cancellation right');
    expect(text).toContain('Consumer rights are not affected');
  });

  it('renders reviewed runtime identity, effective date and retention values', () => {
    const fixture = TestBed.createComponent(LegalNoticeComponent);
    fixture.componentRef.setInput('mode', 'privacy');
    fixture.componentRef.setInput('configuration', {
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
      privacyEmail: 'privacy@example.test',
      supportEmail: 'support@example.test',
      icoRegistrationStatus: 'NOT_REQUIRED_CONFIRMED',
      accountDeletionCompletionDays: 30,
      documentDeletionCompletionDays: 30,
      securityLogRetentionDays: 30,
      supportRecordRetentionDays: 365,
      financialRecordRetentionYears: 6,
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Effective 2026-09-01 · version beta-1');
    expect(fixture.nativeElement.textContent).toContain('Northstar Career Services');
    expect(fixture.nativeElement.textContent).toContain('completed within 30 days');
    expect(fixture.nativeElement.textContent).not.toContain('Draft for legal review');
  });

  it('fails closed if runtime configuration attempts to lower the beta age', () => {
    const fixture = TestBed.createComponent(LegalNoticeComponent);
    fixture.componentRef.setInput('mode', 'privacy');
    fixture.componentRef.setInput('configuration', {
      ready: true,
      status: 'REVIEWED',
      minimumUserAge: 16,
    } as unknown as PublicLegalConfiguration);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Draft for legal review');
    expect(fixture.nativeElement.textContent).not.toContain('Effective undefined');
  });
});
