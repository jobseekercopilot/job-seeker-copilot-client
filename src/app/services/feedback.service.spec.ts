import {HttpErrorResponse, provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {TestBed} from '@angular/core/testing';
import {firstValueFrom} from 'rxjs';
import {
  coarseFeedbackDiagnostics,
  FeedbackService,
  FeedbackSubmission,
  feedbackPayloadValidationError,
  feedbackSubmissionErrorMessage,
} from './feedback.service';
import {publicFeedbackPagePath} from '../../shared/feedback-configuration';

describe('FeedbackService', () => {
  let http: HttpTestingController;
  let service: FeedbackService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(FeedbackService);
  });

  afterEach(() => {
    http.verify();
    history.replaceState({}, '', '/');
  });

  it('posts the exact bounded schema without credentials or privileged headers', async () => {
    const payload = validPayload();
    const result = firstValueFrom(service.submit(
      'https://feedback.example.test/public/feedback',
      payload,
    ));
    const request = http.expectOne('https://feedback.example.test/public/feedback');

    expect(request.request.method).toBe('POST');
    expect(request.request.withCredentials).toBe(false);
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(request.request.headers.has('X-CSRF-Token')).toBe(false);
    expect(request.request.body).toEqual(payload);
    expect(Object.keys(request.request.body).sort()).toEqual([
      'appBuild', 'category', 'description', 'diagnostics', 'diagnosticsConsent',
      'formStartedAt', 'idempotencyKey', 'pagePath', 'reproductionSteps',
      'title', 'website',
    ]);
    request.flush({
      success: true,
      code: 'FEEDBACK_ACCEPTED',
      message: 'backend text is not rendered',
      reference: 'FB-ABCDEF0123456789',
    }, {status: 202, statusText: 'Accepted'});

    await expect(result).resolves.toEqual({
      success: true,
      code: 'FEEDBACK_ACCEPTED',
      message: 'Thank you — your feedback has been saved for review.',
      reference: 'FB-ABCDEF0123456789',
    });
  });

  it('enforces consent coupling, exact keys and the 4 KiB UTF-8 limit before sending', async () => {
    expect(feedbackPayloadValidationError({
      ...validPayload(),
      diagnostics: coarseFeedbackDiagnostics('Chrome/140.0 Mobile'),
    })).toBe('INVALID_PAYLOAD');
    expect(feedbackPayloadValidationError({
      ...validPayload(),
      unexpected: 'not allowed',
    })).toBe('INVALID_PAYLOAD');
    expect(feedbackPayloadValidationError({
      ...validPayload(),
      idempotencyKey: uuidWithVersion('3'),
    })).toBe('INVALID_PAYLOAD');
    expect(feedbackPayloadValidationError({
      ...validPayload(),
      description: 'A description\tcontaining a tab.',
    })).toBe('INVALID_PAYLOAD');
    expect(feedbackPayloadValidationError({
      ...validPayload(),
      pagePath: '/documents//private',
    })).toBe('INVALID_PAYLOAD');
    expect(feedbackPayloadValidationError({
      ...validPayload(),
      pagePath: '/documents\\private',
    })).toBe('INVALID_PAYLOAD');
    expect(feedbackPayloadValidationError({
      ...validPayload(),
      description: '😀'.repeat(1_000),
    })).toBe('REQUEST_TOO_LARGE');

    await expect(firstValueFrom(service.submit(
      'https://feedback.example.test/feedback',
      {...validPayload(), unexpected: true} as FeedbackSubmission,
    ))).rejects.toThrow('payload is invalid');
  });

  it('uses pathname only and bounds it without retaining query or fragment data', () => {
    history.replaceState({}, '', `/documents/${'a'.repeat(300)}?token=private#cv-content`);
    const pagePath = publicFeedbackPagePath(window.location);

    expect(pagePath.startsWith('/documents/')).toBe(true);
    expect([...pagePath]).toHaveLength(256);
    expect(pagePath).not.toContain('token');
    expect(pagePath).not.toContain('private');
    expect(pagePath).not.toContain('cv-content');
  });

  it('reduces user-agent data to the allowed coarse diagnostics', () => {
    expect(coarseFeedbackDiagnostics(
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
    )).toEqual({browserFamily: 'Chrome', browserMajor: 140, deviceClass: 'desktop'});
    expect(coarseFeedbackDiagnostics(
      'Mozilla/5.0 (iPad) Version/18.0 Mobile/15E148 Safari/604.1',
    )).toEqual({browserFamily: 'Safari', browserMajor: 18, deviceClass: 'tablet'});
  });

  it('maps HTTP failures to stable non-leaking messages', () => {
    expect(feedbackSubmissionErrorMessage(new HttpErrorResponse({status: 429})))
      .toContain('Too many feedback reports');
    expect(feedbackSubmissionErrorMessage(new HttpErrorResponse({
      status: 503,
      error: {message: 'private backend detail'},
    }))).toBe('Feedback is temporarily unavailable. Please try again later.');
  });
});

function validPayload(): FeedbackSubmission {
  return {
    appBuild: 'client.2026-08-28.1',
    category: 'BROKEN',
    title: 'Search button is unavailable',
    description: 'The search button stays disabled after entering a location.',
    reproductionSteps: '',
    pagePath: '/dashboard',
    diagnosticsConsent: false,
    diagnostics: null,
    idempotencyKey: uuidWithVersion('4'),
    website: '',
    formStartedAt: 1_787_900_000_000,
  };
}

function uuidWithVersion(version: '3' | '4'): string {
  return ['b2f32c38', 'b653', `${version}e7d`, '9db8', '05d8dc3d9aa5'].join('-');
}
