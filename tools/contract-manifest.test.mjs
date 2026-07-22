import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {verifyContractManifest} from './contract-manifest.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('accepts the pinned contract manifest', async () => {
  const lock = await verifyContractManifest(rootDir);
  assert.deepEqual(lock.contracts.map(({id}) => id), [
    'user-management-gateway',
    'location-gateway',
  ]);
});

test('pins the token-free UMG browser-session contract', async () => {
  const lock = await verifyContractManifest(rootDir);
  const umg = lock.contracts.find(({id}) => id === 'user-management-gateway');
  const contract = JSON.parse(await readFile(resolve(rootDir, umg.path), 'utf8'));

  assert.equal(umg.version, '2.0.0');
  assert.equal(contract.info.version, '2.0.0');
  assert.equal(contract.components.schemas.User.properties.token, undefined);
  assert.equal(contract.components.securitySchemes.browserSession.in, 'cookie');
  assert.equal(contract.components.securitySchemes.browserRefresh.in, 'cookie');
  assert.equal(contract.paths['/api/auth/profile'].get.parameters, undefined);
  assert.deepEqual(umg.requiredPaths, [
    '/api/auth/csrf',
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/profile',
    '/api/auth/refresh',
    '/api/auth/register',
  ]);
});

test('rejects a contract whose content does not match its checksum', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'jsc-contracts-'));
  const lock = JSON.parse(await readFile(resolve(rootDir, 'contracts/contracts.lock.json'), 'utf8'));
  lock.contracts = [lock.contracts[0]];
  const fixtureContract = lock.contracts[0].path;

  await mkdir(dirname(resolve(fixtureRoot, fixtureContract)), {recursive: true});
  await writeFile(resolve(fixtureRoot, 'contracts/contracts.lock.json'), JSON.stringify(lock));
  await writeFile(resolve(fixtureRoot, fixtureContract), '{"tampered":true}');

  await assert.rejects(
    verifyContractManifest(fixtureRoot),
    /user-management-gateway checksum mismatch/,
  );
});

test('rejects an unpinned generator artifact', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'jsc-generator-'));
  const lock = JSON.parse(await readFile(resolve(rootDir, 'contracts/contracts.lock.json'), 'utf8'));
  lock.generator.artifactSha256 = 'not-a-sha256';

  await mkdir(resolve(fixtureRoot, 'contracts'), {recursive: true});
  await writeFile(resolve(fixtureRoot, 'contracts/contracts.lock.json'), JSON.stringify(lock));

  await assert.rejects(
    verifyContractManifest(fixtureRoot),
    /must pin a Maven generator URL, version, and SHA-256/,
  );
});
