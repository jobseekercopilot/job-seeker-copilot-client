import {HttpClient, HttpErrorResponse} from '@angular/common/http';
import {inject, Injectable} from '@angular/core';
import {map, Observable, throwError} from 'rxjs';
import {normalisePublicFeedbackApiUrl} from '../../shared/feedback-configuration';

export const FEEDBACK_MAX_BODY_BYTES = 4_096;
export const FEEDBACK_ACCEPTED_MESSAGE =
  'Thank you — your feedback has been saved for review.';

export type FeedbackCategory = 'BROKEN' | 'CONFUSING' | 'SUGGESTION' | 'OTHER';
export type FeedbackBrowserFamily = 'Chrome' | 'Edge' | 'Firefox' | 'Safari' | 'Other';
export type FeedbackDeviceClass = 'mobile' | 'tablet' | 'desktop';

export interface FeedbackDiagnostics {
  browserFamily: FeedbackBrowserFamily;
  browserMajor: number;
  deviceClass: FeedbackDeviceClass;
}

export interface FeedbackSubmission {
  appBuild: string;
  category: FeedbackCategory;
  title: string;
  description: string;
  reproductionSteps: string;
  pagePath: string;
  diagnosticsConsent: boolean;
  diagnostics: FeedbackDiagnostics | null;
  idempotencyKey: string;
  website: '';
  formStartedAt: number;
}

export interface FeedbackAccepted {
  success: true;
  code: 'FEEDBACK_ACCEPTED';
  message: typeof FEEDBACK_ACCEPTED_MESSAGE;
  reference: string;
}

const FEEDBACK_CATEGORIES = new Set<FeedbackCategory>([
  'BROKEN',
  'CONFUSING',
  'SUGGESTION',
  'OTHER',
]);
const BROWSER_FAMILIES = new Set<FeedbackBrowserFamily>([
  'Chrome',
  'Edge',
  'Firefox',
  'Safari',
  'Other',
]);
const DEVICE_CLASSES = new Set<FeedbackDeviceClass>([
  'mobile',
  'tablet',
  'desktop',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFERENCE = /^FB-[A-F0-9]{16}$/;

@Injectable({providedIn: 'root'})
export class FeedbackService {
  private readonly http = inject(HttpClient);

  submit(
    submissionUrl: string,
    payload: FeedbackSubmission,
  ): Observable<FeedbackAccepted> {
    const normalisedUrl = normalisePublicFeedbackApiUrl(submissionUrl);
    if (!normalisedUrl || normalisedUrl !== submissionUrl) {
      return throwError(() => new Error('Feedback is not configured'));
    }
    if (feedbackPayloadValidationError(payload)) {
      return throwError(() => new Error('Feedback payload is invalid'));
    }

    return this.http.post<unknown>(normalisedUrl, payload, {
      withCredentials: false,
    }).pipe(map(response => {
      if (!isAcceptedResponse(response)) {
        throw new Error('Feedback service returned an invalid response');
      }
      return {
        success: true,
        code: 'FEEDBACK_ACCEPTED',
        message: FEEDBACK_ACCEPTED_MESSAGE,
        reference: response.reference,
      };
    }));
  }
}

export function feedbackPayloadValidationError(
  value: unknown,
): 'INVALID_PAYLOAD' | 'REQUEST_TOO_LARGE' | null {
  if (!isExactFeedbackPayload(value)) return 'INVALID_PAYLOAD';
  return new TextEncoder().encode(JSON.stringify(value)).byteLength > FEEDBACK_MAX_BODY_BYTES
    ? 'REQUEST_TOO_LARGE'
    : null;
}

export function coarseFeedbackDiagnostics(userAgent: string): FeedbackDiagnostics {
  const browser = browserFrom(userAgent);
  const deviceClass: FeedbackDeviceClass =
    /iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(userAgent)
      ? 'tablet'
      : /Mobi|iPhone|iPod|Android/i.test(userAgent)
        ? 'mobile'
        : 'desktop';
  return {...browser, deviceClass};
}

export function createFeedbackIdempotencyKey(
  cryptoImplementation: Crypto = globalThis.crypto,
): string {
  if (typeof cryptoImplementation.randomUUID === 'function') {
    return cryptoImplementation.randomUUID();
  }
  const bytes = cryptoImplementation.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export function feedbackSubmissionErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 429) {
      return 'Too many feedback reports have been sent. Please wait and try again later.';
    }
    if ([400, 413, 415, 422].includes(error.status)) {
      return 'Some feedback fields could not be accepted. Review the form and try again.';
    }
    if ([0, 502, 503, 504].includes(error.status)) {
      return 'Feedback is temporarily unavailable. Please try again later.';
    }
  }
  return 'We could not send your feedback. Please try again.';
}

export function normaliseFeedbackText(value: string, multiline: boolean): string {
  const normalisedLines = value.replace(/\r\n?/g, '\n').trim();
  return multiline
    ? normalisedLines
    : normalisedLines.replace(/\s+/g, ' ');
}

export function feedbackTextIsValid(
  value: string,
  minimum: number,
  maximum: number,
  multiline: boolean,
): boolean {
  const normalised = normaliseFeedbackText(value, multiline);
  const length = [...normalised].length;
  return length >= minimum
    && length <= maximum
    && !hasAsciiControl(normalised, multiline);
}

function browserFrom(userAgent: string): Pick<FeedbackDiagnostics, 'browserFamily' | 'browserMajor'> {
  const patterns: readonly (readonly [FeedbackBrowserFamily, RegExp])[] = [
    ['Edge', /(?:Edg|EdgA|EdgiOS)\/(\d{1,4})/i],
    ['Chrome', /(?:Chrome|CriOS)\/(\d{1,4})/i],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d{1,4})/i],
    ['Safari', /Version\/(\d{1,4}).*Safari\//i],
  ];
  for (const [browserFamily, pattern] of patterns) {
    const match = pattern.exec(userAgent);
    if (match) return {browserFamily, browserMajor: boundedMajor(match[1])};
  }
  const genericVersion = /\/(\d{1,4})(?:[.\s]|$)/.exec(userAgent)?.[1];
  return {browserFamily: 'Other', browserMajor: boundedMajor(genericVersion)};
}

function boundedMajor(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 999 ? parsed : 1;
}

function isExactFeedbackPayload(value: unknown): value is FeedbackSubmission {
  if (!isRecord(value)) return false;
  const expectedKeys = [
    'appBuild',
    'category',
    'description',
    'diagnostics',
    'diagnosticsConsent',
    'formStartedAt',
    'idempotencyKey',
    'pagePath',
    'reproductionSteps',
    'title',
    'website',
  ];
  const actualKeys = Object.keys(value).sort();
  if (actualKeys.length !== expectedKeys.length
      || actualKeys.some((key, index) => key !== expectedKeys[index])) return false;
  if (typeof value['appBuild'] !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value['appBuild'])) return false;
  if (!FEEDBACK_CATEGORIES.has(value['category'] as FeedbackCategory)) return false;
  if (typeof value['title'] !== 'string'
      || value['title'] !== normaliseFeedbackText(value['title'], false)
      || !feedbackTextIsValid(value['title'], 5, 120, false)) return false;
  if (typeof value['description'] !== 'string'
      || value['description'] !== normaliseFeedbackText(value['description'], true)
      || !feedbackTextIsValid(value['description'], 10, 2_000, true)) return false;
  if (typeof value['reproductionSteps'] !== 'string'
      || value['reproductionSteps'] !== normaliseFeedbackText(value['reproductionSteps'], true)
      || !feedbackTextIsValid(value['reproductionSteps'], 0, 1_200, true)) return false;
  if (typeof value['pagePath'] !== 'string'
      || !value['pagePath'].startsWith('/')
      || [...value['pagePath']].length > 256
      || hasAsciiControl(value['pagePath'], false)
      || value['pagePath'].includes('?')
      || value['pagePath'].includes('#')
      || value['pagePath'].includes('//')
      || value['pagePath'].includes('\\')) return false;
  if (typeof value['diagnosticsConsent'] !== 'boolean') return false;
  if (value['diagnosticsConsent']) {
    if (!isDiagnostics(value['diagnostics'])) return false;
  } else if (value['diagnostics'] !== null) return false;
  if (typeof value['idempotencyKey'] !== 'string' || !UUID.test(value['idempotencyKey'])) {
    return false;
  }
  return value['website'] === ''
    && Number.isSafeInteger(value['formStartedAt'])
    && Number(value['formStartedAt']) > 0;
}

function isDiagnostics(value: unknown): value is FeedbackDiagnostics {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 3
    && keys[0] === 'browserFamily'
    && keys[1] === 'browserMajor'
    && keys[2] === 'deviceClass'
    && BROWSER_FAMILIES.has(value['browserFamily'] as FeedbackBrowserFamily)
    && Number.isInteger(value['browserMajor'])
    && Number(value['browserMajor']) >= 1
    && Number(value['browserMajor']) <= 999
    && DEVICE_CLASSES.has(value['deviceClass'] as FeedbackDeviceClass);
}

function isAcceptedResponse(value: unknown): value is {
  success: true;
  code: 'FEEDBACK_ACCEPTED';
  reference: string;
} {
  return isRecord(value)
    && value['success'] === true
    && value['code'] === 'FEEDBACK_ACCEPTED'
    && typeof value['reference'] === 'string'
    && REFERENCE.test(value['reference']);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasAsciiControl(value: string, allowMultiline: boolean): boolean {
  return [...value].some(character => {
    const code = character.codePointAt(0) ?? 0;
    return code === 127
      || (code < 32 && !(allowMultiline && code === 10));
  });
}
