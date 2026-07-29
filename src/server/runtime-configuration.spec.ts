import {
  documentGenerationMode,
  jobSearchProviderMode,
} from './runtime-configuration';

describe('job-search runtime mode', () => {
  it('defaults to the safe fixture label', () => {
    expect(jobSearchProviderMode({})).toBe('FIXTURE');
  });

  it('accepts only the two explicit runtime modes', () => {
    expect(jobSearchProviderMode({JOB_SEARCH_PROVIDER_MODE: 'real'})).toBe('REAL_PROVIDERS');
    expect(jobSearchProviderMode({JOB_SEARCH_PROVIDER_MODE: 'REAL_PROVIDERS'}))
      .toBe('REAL_PROVIDERS');
    expect(jobSearchProviderMode({JOB_SEARCH_PROVIDER_MODE: 'FIXTURE'})).toBe('FIXTURE');
  });

  it('does not echo or expose an invalid setting', () => {
    expect(jobSearchProviderMode({JOB_SEARCH_PROVIDER_MODE: 'secret-value'}))
      .toBe('REQUIRED_VALIDATION');
  });
});

describe('document-generation runtime mode', () => {
  it('fails closed when no explicit mode is configured', () => {
    expect(documentGenerationMode({})).toBe('REQUIRED_VALIDATION');
  });

  it('distinguishes fixture-backed and real OpenAI generation', () => {
    expect(documentGenerationMode({DOCUMENT_GENERATION_MODE: 'FIXTURE_LLM'}))
      .toBe('FIXTURE_LLM');
    expect(documentGenerationMode({DOCUMENT_GENERATION_MODE: 'LIVE'}))
      .toBe('REAL_LLM');
    expect(documentGenerationMode({DOCUMENT_GENERATION_MODE: 'REAL_LLM'}))
      .toBe('REAL_LLM');
  });

  it('does not echo or expose an invalid setting', () => {
    expect(documentGenerationMode({DOCUMENT_GENERATION_MODE: 'secret-value'}))
      .toBe('REQUIRED_VALIDATION');
  });
});
