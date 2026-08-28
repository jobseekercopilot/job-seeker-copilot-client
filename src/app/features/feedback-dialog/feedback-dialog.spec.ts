import {TestBed} from '@angular/core/testing';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import axe from 'axe-core';
import {of} from 'rxjs';
import {FeedbackService, FeedbackSubmission} from '../../services/feedback.service';
import {FeedbackDialogComponent} from './feedback-dialog';

describe('FeedbackDialogComponent', () => {
  const submit = vi.fn();
  const close = vi.fn();

  beforeEach(async () => {
    submit.mockReset();
    close.mockReset();
    submit.mockReturnValue(of({
      success: true,
      code: 'FEEDBACK_ACCEPTED',
      message: 'Thank you — your feedback has been saved for review.',
      reference: 'FB-ABCDEF0123456789',
    }));
    await TestBed.configureTestingModule({
      imports: [FeedbackDialogComponent],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            submissionUrl: 'https://feedback.example.test/public/feedback',
            pagePath: '/documents',
            appBuild: 'client.2026-08-28.1',
          },
        },
        {provide: MatDialogRef, useValue: {close}},
        {provide: FeedbackService, useValue: {submit}},
      ],
    }).compileComponents();
  });

  it('provides labelled fields, explicit privacy guidance and no screenshot control', async () => {
    const fixture = TestBed.createComponent(FeedbackDialogComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('label[for="feedback-category"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('label[for="feedback-title"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('label[for="feedback-description"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('input[type="file"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Screenshots, cookies, browser storage and console logs are not collected');
    expect(fixture.nativeElement.textContent).toContain('Do not include passwords');
    const result = await axe.run(fixture.nativeElement, {
      rules: {'color-contrast': {enabled: false}},
    });
    expect(result.violations.map(violation => violation.id)).toEqual([]);
  });

  it('submits the exact schema with no diagnostics unless consent is selected', async () => {
    const fixture = TestBed.createComponent(FeedbackDialogComponent);
    const component = fixture.componentInstance;
    component.form.controls.category.setValue('CONFUSING');
    component.form.controls.title.setValue('Search location is unclear');
    component.form.controls.description.setValue('  I could not tell which location format to enter.  ');
    component.form.controls.reproductionSteps.setValue('  Open search\r\nEnter Reading  ');

    await component.submit();
    const [url, payload] = submit.mock.calls[0] as [string, FeedbackSubmission];
    expect(url).toBe('https://feedback.example.test/public/feedback');
    expect(payload).toMatchObject({
      category: 'CONFUSING',
      appBuild: 'client.2026-08-28.1',
      title: 'Search location is unclear',
      description: 'I could not tell which location format to enter.',
      reproductionSteps: 'Open search\nEnter Reading',
      pagePath: '/documents',
      diagnosticsConsent: false,
      diagnostics: null,
      website: '',
    });
    expect(payload.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(payload.formStartedAt).toBeGreaterThan(0);
    expect(Object.keys(payload).sort()).toEqual([
      'appBuild', 'category', 'description', 'diagnostics', 'diagnosticsConsent',
      'formStartedAt', 'idempotencyKey', 'pagePath', 'reproductionSteps',
      'title', 'website',
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('FB-ABCDEF0123456789');
    expect(fixture.nativeElement.textContent).toContain('Feedback received');
    expect(document.activeElement?.id).toBe('feedback-confirmation-title');
    expect(fixture.nativeElement.querySelector('#feedback-dialog-description')).not.toBeNull();
  });

  it('includes only coarse diagnostics after explicit consent', async () => {
    const component = TestBed.createComponent(FeedbackDialogComponent).componentInstance;
    component.form.controls.title.setValue('A valid short title');
    component.form.controls.description.setValue('A valid description for this report.');
    component.form.controls.diagnosticsConsent.setValue(true);

    await component.submit();
    const payload = submit.mock.calls[0][1] as FeedbackSubmission;
    expect(payload.diagnosticsConsent).toBe(true);
    expect(payload.diagnostics).toEqual({
      browserFamily: expect.stringMatching(/^(Chrome|Edge|Firefox|Safari|Other)$/),
      browserMajor: expect.any(Number),
      deviceClass: expect.stringMatching(/^(mobile|tablet|desktop)$/),
    });
    expect(payload).not.toHaveProperty('userAgent');
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('screenshot');
  });

  it('announces field errors and prevents oversized UTF-8 submissions', async () => {
    const fixture = TestBed.createComponent(FeedbackDialogComponent);
    const component = fixture.componentInstance;
    await component.submit();
    fixture.detectChanges();
    expect(submit).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('#feedback-title-error')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#feedback-description-error')).not.toBeNull();

    component.form.controls.title.setValue('A valid title');
    component.form.controls.description.setValue('😀'.repeat(1_000));
    await component.submit();
    fixture.detectChanges();
    expect(submit).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent)
      .toContain('too long to send');
  });
});
