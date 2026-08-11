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

test('pins the stabilised progressive-profile and Evidence Library UMG browser contract', async () => {
  const lock = await verifyContractManifest(rootDir);
  const umg = lock.contracts.find(({id}) => id === 'user-management-gateway');
  const contract = JSON.parse(await readFile(resolve(rootDir, umg.path), 'utf8'));

  assert.equal(umg.version, '3.0.0');
  assert.equal(contract.info.version, '3.0.0');
  assert.equal(contract.components.schemas.User.properties.token, undefined);
  assert.equal(contract.components.securitySchemes.browserSession.in, 'cookie');
  assert.equal(contract.components.securitySchemes.browserRefresh.in, 'cookie');
  assert.equal(contract.paths['/api/auth/profile'].get.parameters, undefined);
  assert.ok(contract.paths['/api/auth/password-reset/request'].post);
  assert.ok(contract.paths['/api/auth/password-reset/complete'].post);
  assert.equal(
    contract.paths['/api/auth/password-reset/request'].post.responses['202'].content[
      'application/json'
    ].schema.$ref,
    '#/components/schemas/GatewayResponse',
  );
  assert.ok(contract.components.schemas.PasswordResetCompletionRequest);
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
  assert.equal(
    contract.components.schemas.RegisterRequest.required.includes('profile'),
    false,
  );
  assert.equal(contract.components.schemas.PartialDate.type, 'object');
  assert.deepEqual(
    contract.components.schemas.EvidenceEntry.properties.supersededByEntryId.type,
    ['string', 'null'],
  );
  assert.equal(
    contract.components.schemas.EvidenceWriteRequest.properties.description.maxLength,
    2000,
  );
  assert.equal(
    contract.components.schemas.EvidenceWriteRequest.properties.responsibilities.maxLength,
    2000,
  );
  assert.equal(
    contract.components.schemas.EvidenceWriteRequest.properties.achievements.maxLength,
    2000,
  );
  assert.equal(
    contract.components.schemas.EvidenceFact.properties.factValue.maxLength,
    2000,
  );
  assert.ok(contract.paths['/api/auth/profile'].patch);
  assert.ok(contract.paths['/api/auth/evidence'].post);
  assert.ok(contract.paths['/api/auth/evidence/{entryId}/confirm'].post);
  assert.ok(contract.paths['/api/auth/evidence/{entryId}/archive'].post);
  assert.deepEqual(umg.requiredPaths, [
    '/api/auth/csrf',
    '/api/auth/evidence',
    '/api/auth/evidence/{entryId}',
    '/api/auth/evidence/{entryId}/archive',
    '/api/auth/evidence/{entryId}/confirm',
    '/api/auth/evidence/{entryId}/hide',
    '/api/auth/evidence/{entryId}/restore',
    '/api/auth/evidence/{entryId}/show',
    '/api/auth/evidence/{entryId}/supersede',
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/password-reset/complete',
    '/api/auth/password-reset/request',
    '/api/auth/profile',
    '/api/auth/refresh',
    '/api/auth/register',
  ]);
});

test('pins the session-derived Job Finder search, saved-job and provenance contract', async () => {
  const lock = await verifyContractManifest(rootDir);
  const gateway = lock.contracts.find(({id}) => id === 'job-finder-gateway');
  const contract = JSON.parse(
    await readFile(resolve(rootDir, gateway.path), 'utf8'),
  );
  const savedJob = contract.components.schemas.SavedJobResponse.properties;
  const documentReference =
    contract.components.schemas.DocumentVersionReference.properties;
  const targetRoleResults =
    contract.components.schemas.TargetRoleJobResults;

  assert.equal(gateway.version, '1.12.0');
  assert.equal(gateway.sourceRepository, 'jobseekercopilot/job-finder-gateway');
  assert.equal(
    gateway.sourceCommit,
    '7a8a93126e048a8c5af0676cb4db7e454d577459',
  );
  assert.equal(
    gateway.sha256,
    '6bfa8e70ac94bbac6ab4265360276189092c94b259b6c26a275e0e8617fd029f',
  );
  assert.equal(
    gateway.path,
    'contracts/job-finder-gateway/1.12.0/openapi.json',
  );
  assert.equal(gateway.output, 'src/app/api/job-finder');
  assert.deepEqual(
    contract.components.schemas.Job.properties.advertiserType.enum,
    ['EMPLOYER', 'RECRUITER', 'UNKNOWN'],
  );
  assert.deepEqual(
    contract.components.schemas.Job.properties.descriptionCompleteness.enum,
    ['FULL', 'PREVIEW', 'USER_CONFIRMED', 'UNKNOWN'],
  );
  assert.deepEqual(gateway.requiredPaths, [
    '/api/jobs/search',
    '/api/jobs/provider/{provider}/{externalJobId}',
    '/api/jobs/saved',
    '/api/jobs/saved/{savedJobId}',
    '/api/jobs/applications',
    '/api/jobs/applications/{applicationId}/status',
  ]);
  assert.equal(contract.info.version, '1.12.0');
  assert.deepEqual(
    contract.components.schemas.Job.properties.specialistType.enum,
    ['STANDARD', 'NHS', 'APPRENTICESHIP'],
  );
  assert.equal(
    contract.components.schemas.Job.properties.apprenticeshipDetails.$ref,
    '#/components/schemas/ApprenticeshipDetails',
  );
  assert.equal(
    contract.components.schemas.Job.properties.locations.items.$ref,
    '#/components/schemas/CanonicalLocation',
  );
  assert.equal(savedJob.savedJobId.format, 'uuid');
  assert.equal(savedJob.snapshotVersion.format, 'int64');
  assert.equal(savedJob.contentSha256.type, 'string');
  assert.equal(savedJob.job.$ref, '#/components/schemas/Job');
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
    Object.keys(
      contract.components.schemas.CreateTrackedApplicationRequest.properties,
    ).filter(field => [
      'listingUrl',
      'applyUrl',
      'attributionLabel',
      'attributionSourceUrl',
      'licenceUrl',
      'disclaimer',
    ].includes(field)),
    [
      'listingUrl',
      'applyUrl',
      'attributionLabel',
      'attributionSourceUrl',
      'licenceUrl',
      'disclaimer',
    ],
  );
  assert.deepEqual(
    contract.paths['/api/jobs/applications'].post.security ?? contract.security,
    [{bearerAuth: []}],
  );
  assert.equal(
    contract.paths['/api/jobs/applications'].get.parameters,
    undefined,
  );
  assert.deepEqual(
    contract.paths['/api/jobs/applications/{applicationId}/status'].patch
      .parameters.find(({name}) => name === 'Idempotency-Key'),
    {
      name: 'Idempotency-Key',
      in: 'header',
      description: 'Required replay-safe command key when status is APPLIED',
      required: false,
      schema: {
        maxLength: 128,
        minLength: 1,
        pattern: '[A-Za-z0-9][A-Za-z0-9._:-]{0,127}',
        type: 'string',
      },
    },
  );
  assert.deepEqual(
    contract.components.schemas.UpdateApplicationStatusRequest
      .properties.expectedVersion,
    {
      minimum: 0,
      type: 'integer',
      description: 'Record version last observed by the caller; required when status is APPLIED',
      format: 'int64',
      example: 3,
    },
  );
  assert.ok(
    contract.components.schemas.ApplicationRecordResponse.properties
      .applicationUsedCvDocumentReference,
  );
  assert.deepEqual(
    contract.components.schemas.ApplicationRecordResponse.properties
      .applicationUsedCvState.enum,
    ['UNKNOWN', 'SELECTED', 'OMITTED'],
  );
  assert.deepEqual(
    contract.components.schemas.ApplicationRecordResponse.properties
      .applicationUsedCoverLetterState.enum,
    ['UNKNOWN', 'SELECTED', 'OMITTED'],
  );
  assert.equal(documentReference.sourceType.type, 'string');
  assert.equal(documentReference.originalContentSha256.type, 'string');
  assert.equal(documentReference.selectedAt.format, 'date-time');
  assert.ok(documentReference.evidenceProvenance);
  assert.ok(
    contract.components.schemas.DocumentEvidenceProvenance.properties
      .evidenceSnapshotDigest,
  );
  assert.deepEqual(targetRoleResults.required, [
    'jobs',
    'matchingStatus',
    'page',
    'pageSize',
    'providerResults',
    'searchStatus',
    'targetRole',
    'totalPages',
    'totalResults',
  ]);
  assert.deepEqual(targetRoleResults.properties.page, {
    maximum: 100,
    minimum: 1,
    type: 'integer',
    format: 'int32',
  });
  assert.deepEqual(targetRoleResults.properties.pageSize, {
    maximum: 50,
    minimum: 1,
    type: 'integer',
    format: 'int32',
  });
  assert.equal(targetRoleResults.properties.totalResults.minimum, 0);
  assert.equal(targetRoleResults.properties.totalPages.minimum, 0);
  assert.deepEqual(targetRoleResults.properties.searchStatus.enum, [
    'COMPLETE',
    'PARTIAL',
    'UNAVAILABLE',
  ]);
  assert.deepEqual(targetRoleResults.properties.matchingStatus.enum, [
    'COMPLETE',
    'NOT_RUN',
    'UNAVAILABLE',
    'TIMED_OUT',
    'SATURATED',
  ]);
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
    [
      'missing application evidence provenance',
      (contract) => {
        delete contract.components.schemas.DocumentEvidenceProvenance
          .properties.evidenceSnapshotDigest;
      },
      /must expose canonical application identity, version and exact non-sensitive evidence provenance/,
    ],
    [
      'missing application source provenance',
      (contract) => {
        delete contract.components.schemas.DocumentVersionReference
          .properties.originalContentSha256;
      },
      /must expose canonical application identity, version and exact non-sensitive evidence provenance/,
    ],
    [
      'missing applied expected version',
      (contract) => {
        delete contract.components.schemas.UpdateApplicationStatusRequest
          .properties.expectedVersion;
      },
      /must preserve the observed non-negative record version contract/,
    ],
  ];

  for (const [name, mutate, expected] of cases) {
    await context.test(name, async () => {
      const fixtureRoot = await contractFixture('job-finder-gateway', mutate);
      await assert.rejects(verifyContractManifest(fixtureRoot), expected);
    });
  }
});

test('rejects incomplete or unbounded role-scoped Job Finder paging', async (context) => {
  const requiredFields = [
    'targetRole',
    'jobs',
    'totalResults',
    'page',
    'pageSize',
    'totalPages',
    'providerResults',
    'searchStatus',
    'matchingStatus',
  ];
  for (const field of requiredFields) {
    await context.test(`optional ${field}`, async () => {
      const fixtureRoot = await contractFixture(
        'job-finder-gateway',
        contract => {
          contract.components.schemas.TargetRoleJobResults.required =
            contract.components.schemas.TargetRoleJobResults.required
              .filter(candidate => candidate !== field);
        },
      );
      await assert.rejects(
        verifyContractManifest(fixtureRoot),
        /must require all nine role-scoped result, paging and provider fields/,
      );
    });
  }

  const boundedCases = [
    ['page minimum', 'page', 'minimum', 0],
    ['page maximum', 'page', 'maximum', 101],
    ['page-size minimum', 'pageSize', 'minimum', 0],
    ['page-size maximum', 'pageSize', 'maximum', 51],
    ['total-results minimum', 'totalResults', 'minimum', -1],
    ['total-pages minimum', 'totalPages', 'minimum', -1],
  ];
  for (const [name, field, bound, value] of boundedCases) {
    await context.test(name, async () => {
      const fixtureRoot = await contractFixture(
        'job-finder-gateway',
        contract => {
          contract.components.schemas.TargetRoleJobResults
            .properties[field][bound] = value;
        },
      );
      await assert.rejects(
        verifyContractManifest(fixtureRoot),
        /must preserve bounded role-scoped paging and result types/,
      );
    });
  }

  const statusCases = [
    [
      'non-string search status',
      contract => {
        contract.components.schemas.TargetRoleJobResults
          .properties.searchStatus.type = 'integer';
      },
    ],
    [
      'extra search status',
      contract => {
        contract.components.schemas.TargetRoleJobResults
          .properties.searchStatus.enum.push('UNKNOWN');
      },
    ],
    [
      'non-string matching status',
      contract => {
        contract.components.schemas.TargetRoleJobResults
          .properties.matchingStatus.type = 'integer';
      },
    ],
    [
      'extra matching status',
      contract => {
        contract.components.schemas.TargetRoleJobResults
          .properties.matchingStatus.enum.push('UNKNOWN');
      },
    ],
  ];
  for (const [name, mutate] of statusCases) {
    await context.test(name, async () => {
      const fixtureRoot = await contractFixture(
        'job-finder-gateway',
        mutate,
      );
      await assert.rejects(
        verifyContractManifest(fixtureRoot),
        /must preserve role-scoped search and matching status semantics/,
      );
    });
  }
});

test('pins durable generation, atomic selection and exact lifecycle contracts', async () => {
  const lock = await verifyContractManifest(rootDir);
  const gateway = lock.contracts.find(({id}) => id === 'document-generation-gateway');
  const contract = JSON.parse(await readFile(resolve(rootDir, gateway.path), 'utf8'));
  const start = contract.paths[
    '/api/v1/document-generation/saved-jobs/{savedJobId}/operations'
  ].post;
  const approve = contract.paths[
    '/api/v1/document-generation/operations/{operationId}/approve'
  ].post;
  const saveSelections = contract.paths[
    '/api/v1/document-generation/applications/{applicationId}/document-selections'
  ].put;
  const applicationUpload = contract.paths[
    '/api/v1/document-generation/applications/{applicationId}/document-uploads'
  ].post;
  const applicationUploadStatus = contract.paths[
    '/api/v1/document-generation/application-document-uploads/{operationId}'
  ].get;

  const associations = contract.paths[
    '/api/v1/document-generation/document-versions/{documentId}/application-associations'
  ].get;
  const archive = contract.paths[
    '/api/v1/document-generation/document-versions/{documentId}/archive'
  ].patch;
  const restore = contract.paths[
    '/api/v1/document-generation/document-versions/{documentId}/restore'
  ].patch;
  const recoverableDelete = contract.paths[
    '/api/v1/document-generation/document-versions/{documentId}'
  ].delete;

  assert.equal(gateway.version, '2.6.0');
  assert.equal(gateway.sourceRepository, 'jobseekercopilot/document-generation-gateway');
  assert.equal(gateway.sourceCommit, '21bf336f51f0ce9594cce32b533394314ba570c4');
  assert.equal(
    gateway.sha256,
    '672eac3edfa20b3f6efb25d5b4966c638d0fd480b17bc1eef8b40554f607529b',
  );
  assert.equal(gateway.output, 'src/app/api/document-generation-gateway');
  assert.equal(contract.info.version, '2.6.0');
  assert.equal(start.operationId, 'startOperation');
  assert.equal(start.requestBody.required, true);
  assert.equal(
    start.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/StartGenerationRequest',
  );
  assert.deepEqual(
    contract.components.schemas.StartGenerationRequest.required,
    ['documents'],
  );
  assert.deepEqual(
    contract.components.schemas.StartGenerationRequest.properties.outputs,
    {
      maxItems: 2,
      minItems: 1,
      uniqueItems: true,
      type: 'array',
      items: {type: 'string', enum: ['CV', 'COVER_LETTER']},
    },
  );
  assert.equal(
    contract.components.schemas.StartGenerationRequest.properties.documents.minItems,
    1,
  );
  assert.deepEqual(
    new Set(contract.components.schemas.DocumentEvidenceSelection.required),
    new Set(['purpose', 'entryIds', 'sectionOrder']),
  );
  assert.deepEqual(
    contract.components.schemas.DocumentEvidenceSelection.properties.purpose.enum,
    ['CV', 'COVER_LETTER'],
  );
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
  assert.equal(contract.components.schemas.ApproveGenerationRequest.required, undefined);
  assert.ok(
    contract.components.schemas.GenerationOperationResponse.properties.state.enum
      .includes('AWAITING_APPROVAL'),
  );
  assert.ok(
    contract.components.schemas.GenerationOperationResponse.properties.state.enum
      .includes('GENERATION_OUTCOME_UNKNOWN'),
  );
  assert.equal(saveSelections.operationId, 'save');
  assert.equal(saveSelections.requestBody.required, true);
  assert.deepEqual(
    saveSelections.parameters.map(({name, in: location, required}) => ({
      name,
      location,
      required,
    })),
    [
      {name: 'applicationId', location: 'path', required: true},
      {name: 'Idempotency-Key', location: 'header', required: true},
    ],
  );
  assert.deepEqual(saveSelections.parameters[1].schema, {
    maxLength: 128,
    pattern: '[A-Za-z0-9][A-Za-z0-9._:-]{0,127}',
    type: 'string',
  });
  assert.deepEqual(
    contract.components.schemas.SaveApplicationDocumentSelectionsRequest.required,
    ['coverLetterSelection', 'cvSelection', 'expectedVersion'],
  );
  assert.deepEqual(
    contract.components.schemas.ApplicationDocumentSelectionSlotRequest
      .properties.state.enum,
    ['SELECTED', 'OMITTED'],
  );
  assert.equal(
    saveSelections.responses['409'].content['*/*'].schema.$ref,
    '#/components/schemas/ApplicationSelectionConflictResponse',
  );
  assert.equal(
    contract.components.schemas.ApplicationSelectionConflictResponse
      .properties.currentApplication.$ref,
    '#/components/schemas/ApplicationDocumentSelectionsResponse',
  );
  assert.equal(associations.operationId, 'associations');
  assert.equal(archive.operationId, 'archive');
  assert.equal(restore.operationId, 'restore');
  assert.equal(recoverableDelete.operationId, 'delete');
  assert.ok(recoverableDelete.responses['204']);
  assert.equal(
    archive.responses['200'].content['*/*'].schema.$ref,
    '#/components/schemas/DocumentVersionLifecycleResponse',
  );
  assert.equal(
    associations.responses['200'].content['*/*'].schema.$ref,
    '#/components/schemas/DocumentApplicationAssociationsResponse',
  );
  assert.equal(applicationUpload.operationId, 'upload');
  assert.equal(applicationUploadStatus.operationId, 'get');
  assert.deepEqual(
    applicationUpload.parameters.map(({name, in: location, required}) => ({
      name,
      location,
      required,
    })),
    [
      {name: 'applicationId', location: 'path', required: true},
      {name: 'jobId', location: 'query', required: true},
      {name: 'documentType', location: 'query', required: true},
      {name: 'fileType', location: 'query', required: true},
      {name: 'Idempotency-Key', location: 'header', required: true},
    ],
  );
  assert.equal(
    applicationUpload.requestBody.content['multipart/form-data'].schema
      .properties.file.format,
    'binary',
  );
  assert.deepEqual(
    contract.components.schemas.ApplicationDocumentUploadOperationResponse
      .properties.state.enum,
    ['RECEIVED', 'STORE_READY', 'LINKING', 'COMPLETED', 'RECOVERY_REQUIRED', 'REJECTED'],
  );
  const versionHistory = contract.components.schemas.DocumentVersionHistoryItem
    .properties;
  assert.ok(versionHistory.purgedAt);
  assert.ok(versionHistory.unavailableReason);
  assert.equal(
    versionHistory.applicationAssociations.items.$ref,
    '#/components/schemas/DocumentApplicationAssociation',
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
