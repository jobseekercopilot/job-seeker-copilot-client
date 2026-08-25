import {
  approvedExternalUrl,
  approvedNhsJobsAdvertUrl,
  logMalformedProviderResult,
  providerPlainText,
  sanitiseProviderLinksJson,
} from './provider-content-policy';

describe('provider content URL policy', () => {
  it('turns provider advert HTML and entities into readable inert text', () => {
    expect(providerPlainText(
      '<p>Build APIs &amp; services.</p><ul><li>Java</li><li>AWS &#38; SQL</li></ul>',
    )).toBe('Build APIs & services.\n\n• Java\n• AWS & SQL');
  });

  it('removes active element content, including encoded markup', () => {
    expect(providerPlainText(
      '&lt;p&gt;Safe role&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
    )).toBe('Safe role');
  });

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

  it.each([
    'https://www.jobs.nhs.uk/candidate/jobadvert/C123',
    'https://beta.jobs.nhs.uk/candidate/jobadvert/M0048-26-0423',
  ])('accepts an official NHS Jobs advert URL: %s', (url) => {
    expect(approvedNhsJobsAdvertUrl(url)).toBe(url);
  });

  it.each([
    'http://www.jobs.nhs.uk/candidate/jobadvert/C123',
    'https://www.jobs.nhs.uk/other/C123',
    'https://jobs.nhs.uk.attacker.test/candidate/jobadvert/C123',
    'https://attacker.test/candidate/jobadvert/C123',
  ])('rejects a non-official NHS Jobs advert URL: %s', (url) => {
    expect(approvedNhsJobsAdvertUrl(url)).toBeNull();
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
