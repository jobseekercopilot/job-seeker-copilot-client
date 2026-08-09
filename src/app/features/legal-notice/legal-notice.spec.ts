import {TestBed} from '@angular/core/testing';
import {LegalNoticeComponent} from './legal-notice';

describe('LegalNoticeComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({imports: [LegalNoticeComponent]}).compileComponents();
  });

  it('publishes the bounded Google Maps data flow and retention policy', () => {
    const fixture = TestBed.createComponent(LegalNoticeComponent);
    fixture.componentRef.setInput('mode', 'privacy');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Privacy Policy');
    expect(text).toContain('origin and destination coordinates');
    expect(text).toContain('We do not send Google your name');
    expect(text).toContain('Route distance, duration and provider responses are');
    expect(fixture.nativeElement.querySelector('a[href="https://policies.google.com/privacy"]'))
      .not.toBeNull();
  });

  it('incorporates Google terms and explains that commute results are advisory', () => {
    const fixture = TestBed.createComponent(LegalNoticeComponent);
    fixture.componentRef.setInput('mode', 'terms');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Terms of Use');
    expect(text).toContain('Google Maps/Google Earth Additional Terms');
    expect(text).toContain('Commute information is an estimate for advisory use');
  });
});
