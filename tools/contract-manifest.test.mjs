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
    'document-generation-gateway',
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
  assert.deepEqual(contract.components.schemas.RegisterRequest.properties.name, {
    type: 'string',
    description: 'Display name after trimming, measured in Unicode code points.',
    maxLength: 100,
    minLength: 1,
  });
  assert.deepEqual(contract.components.schemas.RegisterRequest.properties.email, {
    type: 'string',
    format: 'email',
    description: 'Email identity after trimming, measured in Unicode code points.',
    maxLength: 254,
    minLength: 1,
  });
  assert.deepEqual(contract.components.schemas.RegisterRequest.properties.password, {
    type: 'string',
    format: 'password',
    description: 'New password measured in Unicode code points and forwarded exactly as supplied.',
    maxLength: 128,
    minLength: 15,
  });
  assert.deepEqual(contract.components.schemas.LoginRequest.properties.email, {
    type: 'string',
    format: 'email',
    description: 'Email identity after trimming, measured in Unicode code points.',
    maxLength: 254,
    minLength: 1,
  });
  assert.deepEqual(contract.components.schemas.LoginRequest.properties.password, {
    type: 'string',
    format: 'password',
    description: 'Current password measured in Unicode code points and forwarded exactly as supplied.',
    maxLength: 128,
    minLength: 1,
  });
  assert.deepEqual(umg.requiredPaths, [
    '/api/auth/csrf',
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/profile',
    '/api/auth/refresh',
    '/api/auth/register',
  ]);
});

test('pins the durable document-generation contract without browser job input', async () => {
  const lock = await verifyContractManifest(rootDir);
  const gateway = lock.contracts.find(({id}) => id === 'document-generation-gateway');
  const contract = JSON.parse(await readFile(resolve(rootDir, gateway.path), 'utf8'));
  const start = contract.paths[
    '/api/v1/document-generation/saved-jobs/{savedJobId}/operations'
  ].post;
  const approve = contract.paths[
    '/api/v1/document-generation/operations/{operationId}/approve'
  ].post;

  assert.equal(gateway.version, '1.4.0');
  assert.equal(gateway.sourceRepository, 'jobseekercopilot/document-generation-gateway');
  assert.equal(gateway.sourceCommit, '1d03324c2b80fbe44ebb5faccbc158334969464a');
  assert.equal(gateway.output, 'src/generated/api/document-generation-gateway');
  assert.equal(contract.info.version, '1.4.0');
  assert.equal(start.operationId, 'startOperation');
  assert.equal(start.requestBody, undefined);
  assert.deepEqual(
    start.parameters.map(({name, in: location, required}) => ({name, location, required})),
    [
      {name: 'savedJobId', location: 'path', required: true},
      {name: 'Idempotency-Key', location: 'header', required: true},
    ],
  );
  assert.equal(
    start.parameters.some(({name}) => name.toLowerCase() === 'x-user-id'),
    false,
  );
  assert.equal(approve.operationId, 'approveOperation');
  assert.deepEqual(
    contract.components.schemas.ApproveGenerationRequest.required,
    ['coverLetterDocumentId', 'cvDocumentId'],
  );
  assert.ok(
    contract.components.schemas.GenerationOperationResponse.properties.state.enum
      .includes('AWAITING_APPROVAL'),
  );
  assert.ok(
    contract.components.schemas.GenerationOperationResponse.properties.state.enum
      .includes('GENERATION_OUTCOME_UNKNOWN'),
  );
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

test('rejects an unpinned producer revision', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'jsc-producer-'));
  const lock = JSON.parse(await readFile(resolve(rootDir, 'contracts/contracts.lock.json'), 'utf8'));
  lock.contracts[0].sourceCommit = 'develop';

  await mkdir(resolve(fixtureRoot, 'contracts'), {recursive: true});
  await writeFile(resolve(fixtureRoot, 'contracts/contracts.lock.json'), JSON.stringify(lock));

  await assert.rejects(
    verifyContractManifest(fixtureRoot),
    /must pin unique ID, producer, revision, paths, and SHA-256/,
  );
});
