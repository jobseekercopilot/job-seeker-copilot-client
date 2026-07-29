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

  const bearer = document.components?.securitySchemes?.bearerAuth;
  if (bearer?.type !== 'http' || bearer?.scheme !== 'bearer') {
    throw new Error(
      'job-finder-gateway must preserve its HTTP Bearer security scheme',
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
