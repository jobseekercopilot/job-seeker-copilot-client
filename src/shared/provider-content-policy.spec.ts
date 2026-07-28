import {
  approvedExternalUrl,
  logMalformedProviderResult,
  sanitiseProviderLinksJson,
} from './provider-content-policy';

describe('provider content URL policy', () => {
  it.each([
    'https://jobs.example.test/listing/123?source=search',
    'http://jobs.example.test/listing/123',
  ])('accepts an explicit HTTP(S) URL: %s', (url) => {
    expect(approvedExternalUrl(url)).toBe(url);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//jobs.example.test/listing',
    'https://user:secret@jobs.example.test/listing',
    ' https://jobs.example.test/listing',
    'https://jobs.example.test/listing\n',
    'not a URL',
  ])('rejects a non-approved external URL: %s', (url) => {
    expect(approvedExternalUrl(url)).toBeNull();
  });

  it('sanitises only provider link fields throughout a JSON response', () => {
    const result = sanitiseProviderLinksJson(JSON.stringify({
      description: '<img src=x onerror=alert(1)>',
      jobs: [{
        url: 'https://jobs.example.test/1',
        sourceUrl: 'javascript:alert(1)',
        sources: [{
          applyUrl: 'data:text/html,unsafe',
          listingUrl: 'https://publisher.example.test/1',
          attributionSourceUrl: 'https://www.jobs.nhs.uk/',
          licenceUrl: 'javascript:alert(1)',
        }],
      }],
    }));

    expect(JSON.parse(result!)).toEqual({
      description: '<img src=x onerror=alert(1)>',
      jobs: [{
        url: 'https://jobs.example.test/1',
        sourceUrl: null,
        sources: [{
          applyUrl: null,
          listingUrl: 'https://publisher.example.test/1',
          attributionSourceUrl: 'https://www.jobs.nhs.uk/',
          licenceUrl: null,
        }],
      }],
    });
  });

  it('fails closed for malformed JSON', () => {
    expect(sanitiseProviderLinksJson('{"jobs":[')).toBeNull();
  });

  it('logs only a bounded count for malformed provider results', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    logMalformedProviderResult(2);

    expect(warning).toHaveBeenCalledWith(
      '[JobResults] Skipping malformed job',
      {missingFieldCount: 2},
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain('provider');
  });
});
