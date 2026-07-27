export type JobSearchProviderMode =
  | 'FIXTURE'
  | 'REAL_PROVIDERS'
  | 'REQUIRED_VALIDATION';

export function jobSearchProviderMode(
  environment: NodeJS.ProcessEnv = process.env,
): JobSearchProviderMode {
  const configured = environment['JOB_SEARCH_PROVIDER_MODE']?.trim().toUpperCase();
  if (!configured) return 'FIXTURE';
  if (configured === 'FIXTURE') return configured;
  if (configured === 'REAL' || configured === 'REAL_PROVIDERS') {
    return 'REAL_PROVIDERS';
  }
  return 'REQUIRED_VALIDATION';
}

export type DocumentGenerationMode =
  | 'FIXTURE_LLM'
  | 'REQUIRED_VALIDATION';

export function documentGenerationMode(
  environment: NodeJS.ProcessEnv = process.env,
): DocumentGenerationMode {
  const configured = environment['DOCUMENT_GENERATION_MODE']
    ?.trim()
    .toUpperCase();
  return configured === 'FIXTURE' || configured === 'FIXTURE_LLM'
    ? 'FIXTURE_LLM'
    : 'REQUIRED_VALIDATION';
}
