export type JobSearchProviderMode = 'FIXTURE' | 'REAL' | 'REQUIRED_VALIDATION';

export function jobSearchProviderMode(
  environment: NodeJS.ProcessEnv = process.env,
): JobSearchProviderMode {
  const configured = environment['JOB_SEARCH_PROVIDER_MODE']?.trim().toUpperCase();
  if (!configured) return 'FIXTURE';
  if (configured === 'FIXTURE' || configured === 'REAL') return configured;
  return 'REQUIRED_VALIDATION';
}
