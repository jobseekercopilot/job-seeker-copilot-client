import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {verifyContractManifest} from './contract-manifest.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function contractFixture(contractId, mutate) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), `jsc-${contractId}-`));
  const lock = JSON.parse(
    await readFile(resolve(rootDir, 'contracts/contracts.lock.json'), 'utf8'),
  );
  const selected = lock.contracts.find(({id}) => id === contractId);
  const document = JSON.parse(
    await readFile(resolve(rootDir, selected.path), 'utf8'),
  );
  mutate(document);
  const contents = JSON.stringify(document);
  selected.sha256 = createHash('sha256').update(contents).digest('hex');
  lock.contracts = [selected];

  await mkdir(dirname(resolve(fixtureRoot, selected.path)), {recursive: true});
  await writeFile(
    resolve(fixtureRoot, 'contracts/contracts.lock.json'),
    JSON.stringify(lock),
  );
  await writeFile(resolve(fixtureRoot, selected.path), contents);
  return fixtureRoot;
}

test('accepts the pinned contract manifest', async () => {
  const lock = await verifyContractManifest(rootDir);
  assert.deepEqual(lock.contracts.map(({id}) => id), [
    'user-management-gateway',
    'location-gateway',
    'job-finder-gateway',
    'document-generation-gateway',
    'reporting-gateway',
  ]);
});

test('pins the reporting summary and evidence contract', async () => {
  const lock = await verifyContractManifest(rootDir);
  const reporting = lock.contracts.find(({id}) => id === 'reporting-gateway');
  const contract = JSON.parse(
    await readFile(resolve(rootDir, reporting.path), 'utf8'),
  );

  assert.equal(reporting.version, '2.0.0');
  assert.equal(reporting.sourceRepository, 'jobseekercopilot/reporting-gateway');
  assert.equal(
    reporting.sourceCommit,
    '86bead7461413b7b3d75c6ff6cabd1798ca6fdba',
  );
  assert.equal(reporting.output, 'src/app/api/reporting-gateway');
  assert.deepEqual(reporting.requiredPaths, [
    '/api/v1/reports/summary',
    '/api/v1/reports/uc-journal',
    '/api/v1/reports/evidence.txt',
  ]);
  assert.equal(contract.info.version, '2.0.0');
  assert.ok(contract.components.schemas.ReportingSummaryResponse);
  assert.ok(contract.components.schemas.UcJournalResponse);
  assert.ok(contract.paths['/api/v1/reports/evidence.txt']);
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

test('pins the session-derived Job Finder search, saved-job and application contract', async () => {
  const lock = await verifyContractManifest(rootDir);
  const gateway = lock.contracts.find(({id}) => id === 'job-finder-gateway');
  const contract = JSON.parse(
    await readFile(resolve(rootDir, gateway.path), 'utf8'),
  );
  const savedJob = contract.components.schemas.SavedJobResponse.properties;

  assert.equal(gateway.version, '1.5.0');
  assert.equal(gateway.sourceRepository, 'jobseekercopilot/job-finder-gateway');
  assert.equal(
    gateway.sourceCommit,
    'fa8465bdacb947a563b3e134eb30e9f7a062362b',
  );
  assert.equal(gateway.output, 'src/app/api/job-finder');
  assert.deepEqual(gateway.requiredPaths, [
    '/api/jobs/search',
    '/api/jobs/saved',
    '/api/jobs/saved/{savedJobId}',
    '/api/jobs/applications',
    '/api/jobs/applications/{applicationId}/status',
  ]);
  assert.equal(contract.info.version, '1.5.0');
  assert.equal(savedJob.savedJobId.format, 'uuid');
  assert.equal(savedJob.snapshotVersion.format, 'int64');
  assert.equal(savedJob.contentSha256.type, 'string');
  assert.equal(savedJob.job.$ref, '#/components/schemas/Job');
  assert.equal(contract.components.schemas.Job.properties.salaryText.type, 'string');
  assert.deepEqual(
    Object.keys(contract.components.schemas.JobSourceReference.properties)
      .filter(property => [
        'attributionLabel',
        'attributionSourceUrl',
        'licenceUrl',
        'disclaimer',
      ].includes(property)),
    ['attributionLabel', 'attributionSourceUrl', 'licenceUrl', 'disclaimer'],
  );
  assert.deepEqual(
    contract.paths['/api/jobs/saved'].post.responses['201']
      .headers['X-Saved-Job-Outcome'].schema.enum,
    ['CREATED'],
  );
  assert.deepEqual(
    contract.paths['/api/jobs/saved'].post.responses['200']
      .headers['X-Saved-Job-Outcome'].schema.enum,
    ['REPLAYED', 'UPDATED', 'REACTIVATED'],
  );
  assert.equal(
    contract.components.schemas.CreateTrackedApplicationRequest
      .properties.userId,
    undefined,
  );
  assert.deepEqual(
    contract.paths['/api/jobs/applications'].post.security ?? contract.security,
    [{bearerAuth: []}],
  );
  assert.equal(
    contract.paths['/api/jobs/applications'].get.parameters,
    undefined,
  );
});

test('rejects unsafe or incomplete Job Finder saved-job drift', async (context) => {
  const cases = [
    [
      'missing unsave operation',
      (contract) => {
        delete contract.paths['/api/jobs/saved/{savedJobId}'].delete;
      },
      /must preserve DELETE .* as unsave/,
    ],
    [
      'missing Bearer boundary',
      (contract) => {
        contract.paths['/api/jobs/saved'].get.security = [];
      },
      /list must require bearerAuth/,
    ],
    [
      'browser-selected owner header',
      (contract) => {
        contract.paths['/api/jobs/saved'].parameters = [{
          name: 'X-User-Id',
          in: 'header',
        }];
      },
      /save must not accept X-User-Id/,
    ],
    [
      'browser-selected application owner',
      (contract) => {
        contract.components.schemas.CreateTrackedApplicationRequest
          .properties.userId = {type: 'string'};
      },
      /application creation must derive ownership without browser userId/,
    ],
    [
      'missing immutable digest',
      (contract) => {
        delete contract.components.schemas.SavedJobResponse
          .properties.contentSha256;
      },
      /SavedJobResponse is missing contentSha256/,
    ],
    [
      'weakened source state',
      (contract) => {
        contract.components.schemas.SavedJobResponse
          .properties.sourceState.enum = ['SNAPSHOT'];
      },
      /must preserve saved-job source-state semantics/,
    ],
    [
      'missing save outcome',
      (contract) => {
        delete contract.paths['/api/jobs/saved'].post.responses['201']
          .headers['X-Saved-Job-Outcome'];
      },
      /must preserve saved-job outcome semantics/,
    ],
  ];

  for (const [name, mutate, expected] of cases) {
    await context.test(name, async () => {
      const fixtureRoot = await contractFixture('job-finder-gateway', mutate);
      await assert.rejects(verifyContractManifest(fixtureRoot), expected);
    });
  }
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
  assert.equal(gateway.output, 'src/app/api/document-generation-gateway');
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

test('rejects generated output outside the canonical Angular API root', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'jsc-output-root-'));
  const lock = JSON.parse(
    await readFile(resolve(rootDir, 'contracts/contracts.lock.json'), 'utf8'),
  );
  lock.contracts[0].output = 'src/generated/api/user-management-gateway';

  await mkdir(resolve(fixtureRoot, 'contracts'), {recursive: true});
  await writeFile(
    resolve(fixtureRoot, 'contracts/contracts.lock.json'),
    JSON.stringify(lock),
  );

  await assert.rejects(
    verifyContractManifest(fixtureRoot),
    /canonical generated output/,
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
    /must pin unique ID, producer, revision, canonical generated output, paths, and SHA-256/,
  );
});
