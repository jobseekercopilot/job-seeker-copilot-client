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
