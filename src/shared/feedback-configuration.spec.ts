import {
  normalisePublicFeedbackApiUrl,
  normalisePublicAppReleaseId,
  publicFeedbackPagePath,
  publicFeedbackConnectOrigin,
} from './feedback-configuration';

describe('public feedback URL policy', () => {
  it('accepts a full HTTPS endpoint and derives only its origin for CSP', () => {
    const endpoint = 'https://feedback.example.test/public/feedback';
    expect(normalisePublicFeedbackApiUrl(endpoint)).toBe(endpoint);
    expect(publicFeedbackConnectOrigin(endpoint)).toBe('https://feedback.example.test');
  });

  it('accepts only a bounded non-secret release identifier', () => {
    expect(normalisePublicAppReleaseId('client.2026-08-28.1'))
      .toBe('client.2026-08-28.1');
    expect(normalisePublicAppReleaseId('release id with spaces')).toBeUndefined();
    expect(normalisePublicAppReleaseId('a'.repeat(65))).toBeUndefined();
  });

  it.each([
    '',
    ' http://feedback.example.test/feedback',
    'http://feedback.example.test/feedback',
    'https://feedback.example.test/feedback?source=browser',
    'https://feedback.example.test/feedback#fragment',
    'https://user:secret@feedback.example.test/feedback',
    'not-a-url',
  ])('rejects unsafe or non-exact public feedback URLs', value => {
    expect(normalisePublicFeedbackApiUrl(value)).toBeUndefined();
    expect(publicFeedbackConnectOrigin(value)).toBeUndefined();
  });

  it('retains pathname only and caps it at 256 characters', () => {
    history.replaceState({}, '', `/documents/${'a'.repeat(300)}?token=private#cv-content`);
    const path = publicFeedbackPagePath(window.location);
    expect([...path]).toHaveLength(256);
    expect(path).not.toContain('token');
    expect(path).not.toContain('cv-content');
    expect(publicFeedbackPagePath({pathname: '/documents//private'})).toBe('/');
    expect(publicFeedbackPagePath({pathname: '/documents\\private'})).toBe('/');
  });
});
