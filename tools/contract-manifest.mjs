import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const sha256 = (contents) => createHash('sha256').update(contents).digest('hex');

function hasBearerSecurity(operation, document) {
  const security = operation?.security ?? document.security;
  return security?.some((requirement) =>
    Object.hasOwn(requirement, 'bearerAuth'));
}

function validateJobFinderContract(document) {
  const operations = [
    ['/api/jobs/search', 'post', 'searchJobs'],
    ['/api/jobs/provider/{provider}/{externalJobId}', 'get', 'getJobDetails'],
    ['/api/jobs/saved', 'post', 'save'],
    ['/api/jobs/saved', 'get', 'list'],
    ['/api/jobs/saved/{savedJobId}', 'get', 'get'],
    ['/api/jobs/saved/{savedJobId}', 'delete', 'unsave'],
    ['/api/jobs/applications', 'post', 'createApplication'],
    ['/api/jobs/applications', 'get', 'getApplications'],
    ['/api/jobs/applications/{applicationId}/status', 'patch', 'updateApplicationStatus'],
  ];

  for (const [path, method, operationId] of operations) {
    const operation = document.paths?.[path]?.[method];
    if (operation?.operationId !== operationId) {
      throw new Error(
        `job-finder-gateway must preserve ${method.toUpperCase()} ${path} as ${operationId}`,
      );
    }
    if (!hasBearerSecurity(operation, document)) {
      throw new Error(
        `job-finder-gateway ${operationId} must require bearerAuth`,
      );
    }
    const parameters = [
      ...(document.paths[path].parameters ?? []),
      ...(operation.parameters ?? []),
    ];
    if (parameters.some(({name}) => name?.toLowerCase() === 'x-user-id')) {
      throw new Error(
        `job-finder-gateway ${operationId} must not accept X-User-Id`,
      );
    }
  }

  const createApplication =
    document.components?.schemas?.CreateTrackedApplicationRequest;
  if (!createApplication ||
      createApplication.properties?.userId ||
      createApplication.required?.includes('userId')) {
    throw new Error(
      'job-finder-gateway application creation must derive ownership without browser userId',
    );
  }

  const applicationProperties =
    document.components?.schemas?.ApplicationRecordResponse?.properties ?? {};
  const documentReferenceProperties =
    document.components?.schemas?.DocumentVersionReference?.properties ?? {};
  const evidenceProperties =
    document.components?.schemas?.DocumentEvidenceProvenance?.properties ?? {};
  if (!applicationProperties.canonicalJobId ||
      !applicationProperties.provenance ||
      applicationProperties.version?.format !== 'int64' ||
      !applicationProperties.cvDocumentReference ||
      !applicationProperties.applicationUsedCvDocumentReference ||
      !applicationProperties.applicationUsedAt ||
      !documentReferenceProperties.contentSha256 ||
      !documentReferenceProperties.sourceType ||
      !documentReferenceProperties.originalContentSha256 ||
      documentReferenceProperties.selectedAt?.format !== 'date-time' ||
      !documentReferenceProperties.evidenceProvenance ||
      !documentReferenceProperties.groundingState ||
      !evidenceProperties.profileRevisionId ||
      !evidenceProperties.profileContentDigest ||
      !evidenceProperties.evidenceSnapshotId ||
      !evidenceProperties.evidenceSnapshotDigest ||
      !evidenceProperties.evidenceRevisions ||
      !evidenceProperties.claimLedger) {
    throw new Error(
      'job-finder-gateway must expose canonical application identity, version and exact non-sensitive evidence provenance',
    );
  }

  const targetRoleResults =
    document.components?.schemas?.TargetRoleJobResults;
  const targetRoleProperties = targetRoleResults?.properties ?? {};
  const requiredTargetRoleProperties = [
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
  if (!targetRoleResults ||
      !requiredTargetRoleProperties.every(property =>
        targetRoleResults.required?.includes(property) &&
        targetRoleProperties[property])) {
    throw new Error(
      'job-finder-gateway TargetRoleJobResults must require all nine role-scoped result, paging and provider fields',
    );
  }
  if (targetRoleProperties.targetRole.type !== 'string' ||
      targetRoleProperties.jobs.type !== 'array' ||
      targetRoleProperties.jobs.items?.$ref !== '#/components/schemas/Job' ||
      targetRoleProperties.totalResults.type !== 'integer' ||
      targetRoleProperties.totalResults.format !== 'int32' ||
      targetRoleProperties.totalResults.minimum !== 0 ||
      targetRoleProperties.page.type !== 'integer' ||
      targetRoleProperties.page.format !== 'int32' ||
      targetRoleProperties.page.minimum !== 1 ||
      targetRoleProperties.page.maximum !== 100 ||
      targetRoleProperties.pageSize.type !== 'integer' ||
      targetRoleProperties.pageSize.format !== 'int32' ||
      targetRoleProperties.pageSize.minimum !== 1 ||
      targetRoleProperties.pageSize.maximum !== 50 ||
      targetRoleProperties.totalPages.type !== 'integer' ||
      targetRoleProperties.totalPages.format !== 'int32' ||
      targetRoleProperties.totalPages.minimum !== 0 ||
      targetRoleProperties.providerResults.type !== 'array' ||
      targetRoleProperties.providerResults.items?.$ref !==
        '#/components/schemas/ProviderResultStatus') {
    throw new Error(
      'job-finder-gateway TargetRoleJobResults must preserve bounded role-scoped paging and result types',
    );
  }
  const requiredSearchStatuses = ['COMPLETE', 'PARTIAL', 'UNAVAILABLE'];
  const requiredMatchingStatuses = [
    'COMPLETE',
    'NOT_RUN',
    'UNAVAILABLE',
    'TIMED_OUT',
    'SATURATED',
  ];
  if (targetRoleProperties.searchStatus.type !== 'string' ||
      targetRoleProperties.matchingStatus.type !== 'string' ||
      JSON.stringify(targetRoleProperties.searchStatus.enum) !==
        JSON.stringify(requiredSearchStatuses) ||
      JSON.stringify(targetRoleProperties.matchingStatus.enum) !==
        JSON.stringify(requiredMatchingStatuses)) {
    throw new Error(
      'job-finder-gateway TargetRoleJobResults must preserve role-scoped search and matching status semantics',
    );
  }
  if (document.components?.schemas?.ReedJobSearchResponse?.properties
      ?.resultsByTargetRole?.items?.$ref !==
        '#/components/schemas/TargetRoleJobResults') {
    throw new Error(
      'job-finder-gateway search response must expose TargetRoleJobResults',
    );
  }

  const bearer = document.components?.securitySchemes?.bearerAuth;
  if (bearer?.type !== 'http' || bearer?.scheme !== 'bearer') {
    throw new Error(
      'job-finder-gateway must preserve its HTTP Bearer security scheme',
    );
  }

  const jobProperties = document.components?.schemas?.Job?.properties ?? {};
  if (!jobProperties.specialistType?.enum?.includes('NHS') ||
      !jobProperties.specialistType?.enum?.includes('APPRENTICESHIP') ||
      jobProperties.locations?.items?.$ref !== '#/components/schemas/CanonicalLocation' ||
      jobProperties.apprenticeshipDetails?.$ref !== '#/components/schemas/ApprenticeshipDetails') {
    throw new Error(
      'job-finder-gateway must preserve specialist classification, all locations and apprenticeship details',
    );
  }

  const savedJobProperties =
    document.components?.schemas?.SavedJobResponse?.properties ?? {};
  const requiredSavedJobProperties = [
    'savedJobId',
    'canonicalJobId',
    'canonicalSchemaVersion',
    'snapshotVersion',
    'contentVersion',
    'contentSha256',
    'capturedAt',
    'sourceRetrievedAt',
    'sourceState',
    'savedAt',
    'updatedAt',
    'job',
  ];
  for (const property of requiredSavedJobProperties) {
    if (!savedJobProperties[property]) {
      throw new Error(
        `job-finder-gateway SavedJobResponse is missing ${property}`,
      );
    }
  }
  if (savedJobProperties.savedJobId.format !== 'uuid' ||
      savedJobProperties.snapshotVersion.format !== 'int64' ||
      savedJobProperties.job.$ref !== '#/components/schemas/Job') {
    throw new Error(
      'job-finder-gateway must preserve saved-job identity, version and snapshot types',
    );
  }
  const sourceStates = savedJobProperties.sourceState.enum ?? [];
  if (!sourceStates.includes('SNAPSHOT') ||
      !sourceStates.includes('EXPIRED_SNAPSHOT')) {
    throw new Error(
      'job-finder-gateway must preserve saved-job source-state semantics',
    );
  }

  const saveResponses = document.paths['/api/jobs/saved'].post.responses;
  const createdOutcomes =
    saveResponses?.['201']?.headers?.['X-Saved-Job-Outcome']?.schema?.enum;
  const replayOutcomes =
    saveResponses?.['200']?.headers?.['X-Saved-Job-Outcome']?.schema?.enum;
  if (JSON.stringify(createdOutcomes) !== JSON.stringify(['CREATED']) ||
      !['REPLAYED', 'UPDATED', 'REACTIVATED']
        .every((outcome) => replayOutcomes?.includes(outcome))) {
    throw new Error(
      'job-finder-gateway must preserve saved-job outcome semantics',
    );
  }
}

export async function verifyContractManifest(rootDir = defaultRoot) {
  const lockPath = resolve(rootDir, 'contracts/contracts.lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));

  if (lock.schemaVersion !== 1 || !Array.isArray(lock.contracts) || lock.contracts.length === 0) {
    throw new Error('contracts.lock.json must contain at least one schemaVersion 1 contract');
  }
  if (!/^https:\/\/repo1\.maven\.org\//.test(lock.generator?.artifactUrl ?? '') ||
      !/^[a-f0-9]{64}$/.test(lock.generator?.artifactSha256 ?? '') ||
      !/^\d+\.\d+\.\d+$/.test(lock.generator?.engineVersion ?? '')) {
    throw new Error('contracts.lock.json must pin a Maven generator URL, version, and SHA-256');
  }

  const contractIds = new Set();
  for (const contract of lock.contracts) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(contract.id ?? '') ||
        contractIds.has(contract.id) ||
        !/^jobseekercopilot\/[a-z0-9][a-z0-9.-]*$/.test(contract.sourceRepository ?? '') ||
        !/^[a-f0-9]{40}$/.test(contract.sourceCommit ?? '') ||
        !/^contracts\/(?!.*(?:^|\/)\.\.(?:\/|$)).+\.json$/.test(contract.path ?? '') ||
        !/^src\/app\/api(?:\/[a-z0-9][a-z0-9-]*)*$/.test(contract.output ?? '') ||
        !/^[a-f0-9]{64}$/.test(contract.sha256 ?? '')) {
      throw new Error(`${contract.id ?? 'unknown contract'} must pin unique ID, producer, revision, canonical generated output, paths, and SHA-256`);
    }
    contractIds.add(contract.id);

    const contractPath = resolve(rootDir, contract.path);
    const contents = await readFile(contractPath);
    const actualHash = sha256(contents);
    if (actualHash !== contract.sha256) {
      throw new Error(`${contract.id} checksum mismatch: expected ${contract.sha256}, got ${actualHash}`);
    }

    const document = JSON.parse(contents.toString('utf8'));
    if (document.info?.version !== contract.version) {
      throw new Error(`${contract.id} version mismatch: expected ${contract.version}, got ${document.info?.version ?? 'missing'}`);
    }
    for (const requiredPath of contract.requiredPaths) {
      if (!document.paths?.[requiredPath]) {
        throw new Error(`${contract.id} is missing required path ${requiredPath}`);
      }
    }
    if (contract.id === 'job-finder-gateway') {
      validateJobFinderContract(document);
    }
  }

  return lock;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyContractManifest()
    .then((lock) => console.log(`Verified ${lock.contracts.length} pinned OpenAPI contracts.`))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
