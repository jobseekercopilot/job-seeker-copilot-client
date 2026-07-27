import {jobSearchProviderMode} from './runtime-configuration';

describe('job-search runtime mode', () => {
  it('defaults to the safe fixture label', () => {
    expect(jobSearchProviderMode({})).toBe('FIXTURE');
  });

  it('accepts only the two explicit runtime modes', () => {
    expect(jobSearchProviderMode({JOB_SEARCH_PROVIDER_MODE: 'real'})).toBe('REAL');
    expect(jobSearchProviderMode({JOB_SEARCH_PROVIDER_MODE: 'FIXTURE'})).toBe('FIXTURE');
  });

  it('does not echo or expose an invalid setting', () => {
    expect(jobSearchProviderMode({JOB_SEARCH_PROVIDER_MODE: 'secret-value'}))
      .toBe('REQUIRED_VALIDATION');
  });
});
