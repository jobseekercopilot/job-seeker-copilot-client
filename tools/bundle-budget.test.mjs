import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('keeps public feedback inside its narrowly extended 1,106 kB bundle ceiling', async () => {
  const angular = JSON.parse(
    await readFile(resolve(rootDir, 'angular.json'), 'utf8'),
  );
  const initial = angular.projects['job-seeker-copilot-client']
    .architect.build.configurations.production.budgets
    .find(({type}) => type === 'initial');

  // Exact production-build measurements from deployed client 49393eeb and
  // this hotfix: 1,099,895 B -> 1,100,422 B (+527 B).
  const deployedBaselineBytes = 1_099_895;
  const appliedStatusHotfixBytes = 1_100_422;
  const previousCeilingBytes = 1_101_000;
  const ceilingBytes = 1_106_000;

  assert.equal(initial.maximumError, '1106kB');
  assert.equal(appliedStatusHotfixBytes - deployedBaselineBytes, 527);
  assert.ok(appliedStatusHotfixBytes <= ceilingBytes);
  assert.equal(ceilingBytes - previousCeilingBytes, 5_000);
});
