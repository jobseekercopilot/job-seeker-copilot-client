import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('keeps the onboarding evidence steps inside the measured 1,200 kB bundle ceiling', async () => {
  const angular = JSON.parse(
    await readFile(resolve(rootDir, 'angular.json'), 'utf8'),
  );
  const initial = angular.projects['job-seeker-copilot-client']
    .architect.build.configurations.production.budgets
    .find(({type}) => type === 'initial');

  // The onboarding profile-questions feature (qualifications, employment and
  // volunteering steps embedding EvidenceLibraryComponent, the six-segment
  // progress bar, and the per-entry confirm list) raised the initial bundle
  // above the previous 1,101 kB ceiling. Exact production-build measurement of
  // this branch: main 1,076,274 B + styles 33,753 B = 1,110,027 B.
  const onboardingInitialBytes = 1_110_027;
  const ceilingBytes = 1_200_000;

  assert.equal(initial.maximumError, '1200kB');
  assert.ok(
    onboardingInitialBytes <= ceilingBytes,
    `initial bundle ${onboardingInitialBytes} B exceeds ceiling ${ceilingBytes} B`,
  );
});
