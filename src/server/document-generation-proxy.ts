import type {Express, Request, Response} from 'express';
import {randomUUID} from 'node:crypto';
import {
  downstreamFailureCategory,
  fetchAndConsumeWithTimeout,
  fetchTextWithTimeout,
} from './bff-boundary';
import {
  jobFinderCredentials,
  type JobFinderProxyConfig,
} from './job-finder-proxy';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const OPERATION_STATES = new Set([
  'CREATED',
  'SNAPSHOTS_RESOLVED',
  'ESTIMATED',
  'CREDIT_RESERVED',
  'GENERATION_IN_PROGRESS',
  'GENERATION_OUTCOME_UNKNOWN',
  'DRAFT_GENERATED',
  'CREDIT_COMMITTED',
  'DRAFTS_STORED',
  'AWAITING_APPROVAL',
  'APPROVED',
  'CV_EXPORT_IN_PROGRESS',
  'CV_EXPORTED',
  'COVER_LETTER_EXPORT_IN_PROGRESS',
  'EXPORTED',
  'COMPLETED',
  'RECOVERY_REQUIRED',
  'FAILED',
  'CANCELLED',
]);
const SAFE_DOWNLOAD_TYPES = new Set([
  'application/octet-stream',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const DOCUMENT_TYPES = new Set(['CV', 'COVER_LETTER']);
const EVIDENCE_SECTIONS = new Set([
  'EMPLOYMENT',
  'EDUCATION',
  'QUALIFICATION_TRAINING',
  'PROJECT',
  'VOLUNTEERING',
  'FREELANCE',
  'ACHIEVEMENT',
  'CAREER_BREAK',
  'OTHER',
]);
const MAX_MULTIPART_BYTES = (25 * 1024 * 1024) + (64 * 1024);
const MULTIPART_CONTENT_TYPE =
  /^multipart\/form-data;\s*boundary=(?:"[^"\r\n;]{1,200}"|[^\s\r\n;]{1,200})$/i;

export interface DocumentGenerationProxyConfig extends JobFinderProxyConfig {
  documentStoreOrigin: string;
}

class RequestTooLargeError extends Error {
  override readonly name = 'RequestTooLargeError';
}

interface ProxyPayload {
  body: string;
  contentType: string;
  status: number;
}

interface DownloadHeaders {
  cacheControl: string;
  contentDisposition: string;
  contentLength: number;
  contentType: string;
  pragma: string;
  xContentTypeOptions: string;
}

type JsonMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';

function validUuid(value: string): boolean {
  return UUID.test(value);
}

interface DocumentEvidenceSelectionBody {
  purpose: 'CV' | 'COVER_LETTER';
  entryIds: string[];
  sectionOrder: string[];
}

interface StartGenerationBody {
  documents: DocumentEvidenceSelectionBody[];
}

interface ApproveGenerationBody {
  cvDocumentId: string;
  coverLetterDocumentId: string;
}

type DocumentSelection =
  | {state: 'SELECTED'; documentId: string}
  | {state: 'OMITTED'};

interface SaveDocumentSelectionsBody {
  cvSelection: DocumentSelection;
  coverLetterSelection: DocumentSelection;
  expectedVersion: number;
}

const APPLICATION_STATES = new Set([
  'SAVED',
  'DOCUMENTS_GENERATED',
  'APPLIED',
  'INTERVIEW',
  'UNSUCCESSFUL',
  'OFFER',
  'ACCEPTED',
  'REJECTED_BY_USER',
  'WITHDRAWN',
]);
const DOCUMENT_LIFECYCLE_STATES = new Set(['DRAFT', 'APPROVED']);
const DOCUMENT_RETENTION_STATES = new Set([
  'AVAILABLE',
  'ARCHIVED',
  'DELETED',
  'PURGED',
]);
const DOCUMENT_ASSOCIATION_STATES = new Set([
  'DRAFT_SELECTED',
  'FROZEN_USED',
]);
const DOCUMENT_SOURCES = new Set(['GENERATED', 'UPLOADED']);
const ARTIFACT_ROLES = new Set(['ORIGINAL', 'DERIVED']);
const ARTIFACT_FORMATS = new Set(['DOCX', 'PDF']);
const ARTIFACT_AVAILABILITY = new Set(['AVAILABLE', 'UNAVAILABLE']);
const UNAVAILABLE_REASON = /^[A-Z][A-Z0-9_]{0,63}$/;

function exactObjectKeys(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function startGenerationBody(value: unknown): StartGenerationBody | undefined {
  if (!exactObjectKeys(value, ['documents']) || !Array.isArray(value['documents'])) {
    return undefined;
  }
  if (value['documents'].length !== 2) return undefined;

  const expectedPurposes = ['CV', 'COVER_LETTER'] as const;
  const documents: DocumentEvidenceSelectionBody[] = [];
  for (const [index, candidate] of value['documents'].entries()) {
    if (!exactObjectKeys(candidate, ['purpose', 'entryIds', 'sectionOrder'])) {
      return undefined;
    }
    const purpose = candidate['purpose'];
    const entryIds = candidate['entryIds'];
    const sectionOrder = candidate['sectionOrder'];
    if (
      purpose !== expectedPurposes[index]
      || !Array.isArray(entryIds)
      || entryIds.length < 1
      || entryIds.length > 50
      || !entryIds.every(entryId => typeof entryId === 'string' && validUuid(entryId))
      || new Set(entryIds.map(entryId => entryId.toLowerCase())).size !== entryIds.length
      || !Array.isArray(sectionOrder)
      || sectionOrder.length < 1
      || sectionOrder.length > EVIDENCE_SECTIONS.size
      || !sectionOrder.every(section =>
        typeof section === 'string' && EVIDENCE_SECTIONS.has(section))
      || new Set(sectionOrder).size !== sectionOrder.length
    ) {
      return undefined;
    }
    documents.push({
      purpose: purpose as 'CV' | 'COVER_LETTER',
      entryIds: entryIds.map(entryId => entryId.toLowerCase()),
      sectionOrder: [...sectionOrder] as string[],
    });
  }
  return {documents};
}

function approveGenerationBody(value: unknown): ApproveGenerationBody | undefined {
  if (!exactObjectKeys(value, ['cvDocumentId', 'coverLetterDocumentId'])) {
    return undefined;
  }
  const cvDocumentId = value['cvDocumentId'];
  const coverLetterDocumentId = value['coverLetterDocumentId'];
  if (
    typeof cvDocumentId !== 'string'
    || !validUuid(cvDocumentId)
    || typeof coverLetterDocumentId !== 'string'
    || !validUuid(coverLetterDocumentId)
    || cvDocumentId.toLowerCase() === coverLetterDocumentId.toLowerCase()
  ) {
    return undefined;
  }
  return {
    cvDocumentId: cvDocumentId.toLowerCase(),
    coverLetterDocumentId: coverLetterDocumentId.toLowerCase(),
  };
}

function documentSelection(value: unknown): DocumentSelection | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const state = (value as Record<string, unknown>)['state'];
  if (state === 'OMITTED' && exactObjectKeys(value, ['state'])) {
    return {state};
  }
  if (!exactObjectKeys(value, ['state', 'documentId']) || state !== 'SELECTED') {
    return undefined;
  }
  const documentId = value['documentId'];
  return typeof documentId === 'string' && validUuid(documentId)
    ? {state, documentId: documentId.toLowerCase()}
    : undefined;
}

function saveDocumentSelectionsBody(
  value: unknown,
): SaveDocumentSelectionsBody | undefined {
  if (!exactObjectKeys(
    value,
    ['cvSelection', 'coverLetterSelection', 'expectedVersion'],
  )) {
    return undefined;
  }
  const cvSelection = documentSelection(value['cvSelection']);
  const coverLetterSelection = documentSelection(value['coverLetterSelection']);
  const expectedVersion = value['expectedVersion'];
  if (
    !cvSelection
    || !coverLetterSelection
    || typeof expectedVersion !== 'number'
    || !Number.isSafeInteger(expectedVersion)
    || expectedVersion < 0
  ) {
    return undefined;
  }
  return {cvSelection, coverLetterSelection, expectedVersion};
}

function sendFailure(
  response: Response,
  status: number,
  error: string,
  message: string,
): void {
  response
    .status(status)
    .setHeader('Cache-Control', 'private, no-store')
    .json({error, message});
}

async function callJson(
  config: DocumentGenerationProxyConfig,
  origin: string,
  path: string,
  request: Request,
  method: JsonMethod,
  requiresCsrf: boolean,
  fetchImplementation: typeof fetch,
  additionalHeaders: Record<string, string> = {},
  forwardJsonBody = ['POST', 'PUT'].includes(method),
): Promise<ProxyPayload | undefined> {
  const credentials = jobFinderCredentials(
    request.headers,
    config,
    requiresCsrf,
    forwardJsonBody,
  );
  if ('status' in credentials) return {
    body: JSON.stringify({
      error: credentials.error,
      message: credentials.message,
    }),
    contentType: 'application/json',
    status: credentials.status,
  };

  const {body, response} = await fetchTextWithTimeout(
    `${origin}${path}`,
    {
      method,
      headers: {...credentials.headers, ...additionalHeaders},
      body: forwardJsonBody
        ? JSON.stringify(request.body)
        : undefined,
    },
    config.timeoutMs,
    fetchImplementation,
  );
  const accessToken = credentials.headers['Authorization'].slice('Bearer '.length);
  if (body.includes(accessToken)) return undefined;

  const upstreamType = response.headers
    .get('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase();
  return {
    body,
    contentType: upstreamType === 'application/problem+json'
      ? 'application/problem+json'
      : 'application/json',
    status: response.status,
  };
}

function requestCorrelationId(request: Request): string {
  const candidate = request.get('X-Correlation-ID')?.trim();
  return candidate && CORRELATION_ID.test(candidate)
    ? candidate
    : randomUUID();
}

function safeTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 64) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : value;
}

function safeDocumentAssociation(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (
    typeof source['applicationId'] !== 'string'
    || !validUuid(source['applicationId'])
    || typeof source['documentType'] !== 'string'
    || !DOCUMENT_TYPES.has(source['documentType'])
    || typeof source['associationState'] !== 'string'
    || !DOCUMENT_ASSOCIATION_STATES.has(source['associationState'])
    || typeof source['applicationStatus'] !== 'string'
    || !APPLICATION_STATES.has(source['applicationStatus'])
  ) {
    return undefined;
  }
  const frozenAt = safeTimestamp(source['frozenAt']);
  return {
    applicationId: source['applicationId'].toLowerCase(),
    documentType: source['documentType'],
    associationState: source['associationState'],
    applicationStatus: source['applicationStatus'],
    ...(frozenAt ? {frozenAt} : {}),
  };
}

function safeDocumentAssociationsPayload(
  body: string,
): Record<string, unknown> | undefined {
  const source = parsedJson(body);
  if (
    !source
    || typeof source['documentId'] !== 'string'
    || !validUuid(source['documentId'])
    || !Array.isArray(source['associations'])
    || source['associations'].length > 1_000
  ) {
    return undefined;
  }
  const associations = source['associations'].map(safeDocumentAssociation);
  if (associations.some(association => !association)) return undefined;
  return {
    documentId: source['documentId'].toLowerCase(),
    associationCount: associations.length,
    associations,
  };
}

function safeDocumentLifecyclePayload(
  body: string,
): Record<string, unknown> | undefined {
  const source = parsedJson(body);
  if (
    !source
    || typeof source['id'] !== 'string'
    || !validUuid(source['id'])
    || typeof source['documentFamilyId'] !== 'string'
    || !validUuid(source['documentFamilyId'])
    || typeof source['documentType'] !== 'string'
    || !DOCUMENT_TYPES.has(source['documentType'])
    || typeof source['version'] !== 'number'
    || !Number.isSafeInteger(source['version'])
    || source['version'] < 1
    || typeof source['lifecycleState'] !== 'string'
    || !DOCUMENT_LIFECYCLE_STATES.has(source['lifecycleState'])
    || typeof source['retentionState'] !== 'string'
    || !DOCUMENT_RETENTION_STATES.has(source['retentionState'])
    || typeof source['current'] !== 'boolean'
  ) {
    return undefined;
  }
  const safe: Record<string, unknown> = {
    id: source['id'].toLowerCase(),
    documentFamilyId: source['documentFamilyId'].toLowerCase(),
    documentType: source['documentType'],
    version: source['version'],
    lifecycleState: source['lifecycleState'],
    retentionState: source['retentionState'],
    current: source['current'],
  };
  for (const field of [
    'archivedAt',
    'deletedAt',
    'purgeEligibleAt',
    'purgedAt',
  ]) {
    const timestamp = safeTimestamp(source[field]);
    if (timestamp) safe[field] = timestamp;
  }
  const unavailableReason = source['unavailableReason'];
  if (
    typeof unavailableReason === 'string'
    && UNAVAILABLE_REASON.test(unavailableReason)
  ) {
    safe['unavailableReason'] = unavailableReason;
  }
  return safe;
}

function safeDocumentArtifact(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (
    typeof source['artifactId'] !== 'string'
    || !validUuid(source['artifactId'])
    || typeof source['role'] !== 'string'
    || !ARTIFACT_ROLES.has(source['role'])
    || typeof source['format'] !== 'string'
    || !ARTIFACT_FORMATS.has(source['format'])
    || typeof source['source'] !== 'string'
    || !['GENERATED', 'USER_UPLOADED'].includes(source['source'])
    || typeof source['availability'] !== 'string'
    || !ARTIFACT_AVAILABILITY.has(source['availability'])
    || typeof source['size'] !== 'number'
    || !Number.isSafeInteger(source['size'])
    || source['size'] < 0
  ) {
    return undefined;
  }
  const safe: Record<string, unknown> = {
    artifactId: source['artifactId'].toLowerCase(),
    role: source['role'],
    format: source['format'],
    source: source['source'],
    availability: source['availability'],
    size: source['size'],
  };
  for (const field of ['storedAt', 'createdAt', 'updatedAt']) {
    const timestamp = safeTimestamp(source[field]);
    if (timestamp) safe[field] = timestamp;
  }
  return safe;
}

function safeDocumentVersionHistoryItem(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (
    typeof source['documentId'] !== 'string'
    || !validUuid(source['documentId'])
    || typeof source['version'] !== 'number'
    || !Number.isSafeInteger(source['version'])
    || source['version'] < 1
    || typeof source['source'] !== 'string'
    || !DOCUMENT_SOURCES.has(source['source'])
    || typeof source['lifecycle'] !== 'string'
    || !DOCUMENT_LIFECYCLE_STATES.has(source['lifecycle'])
    || typeof source['retention'] !== 'string'
    || !DOCUMENT_RETENTION_STATES.has(source['retention'])
    || typeof source['current'] !== 'boolean'
    || !Array.isArray(source['applicationAssociations'])
    || source['applicationAssociations'].length > 1_000
    || !Array.isArray(source['artifacts'])
    || source['artifacts'].length > 20
  ) {
    return undefined;
  }
  const associations = source['applicationAssociations'].map(safeDocumentAssociation);
  const artifacts = source['artifacts'].map(safeDocumentArtifact);
  if (associations.some(item => !item) || artifacts.some(item => !item)) return undefined;

  const safe: Record<string, unknown> = {
    documentId: source['documentId'].toLowerCase(),
    version: source['version'],
    source: source['source'],
    lifecycle: source['lifecycle'],
    retention: source['retention'],
    current: source['current'],
    applicationAssociations: associations,
    artifacts,
  };
  if (typeof source['title'] === 'string' && source['title'].length <= 300) {
    safe['title'] = source['title'];
  }
  for (const field of [
    'approvedAt',
    'archivedAt',
    'deletedAt',
    'purgeEligibleAt',
    'purgedAt',
    'createdAt',
    'updatedAt',
  ]) {
    const timestamp = safeTimestamp(source[field]);
    if (timestamp) safe[field] = timestamp;
  }
  const unavailableReason = source['unavailableReason'];
  if (typeof unavailableReason === 'string' && UNAVAILABLE_REASON.test(unavailableReason)) {
    safe['unavailableReason'] = unavailableReason;
  }
  return safe;
}

function safeDocumentFamilySummary(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (
    typeof source['documentFamilyId'] !== 'string'
    || !validUuid(source['documentFamilyId'])
    || typeof source['jobId'] !== 'string'
    || source['jobId'].length < 1
    || source['jobId'].length > 2_048
    || typeof source['documentType'] !== 'string'
    || !DOCUMENT_TYPES.has(source['documentType'])
    || typeof source['latestDocumentId'] !== 'string'
    || !validUuid(source['latestDocumentId'])
    || typeof source['latestVersion'] !== 'number'
    || !Number.isSafeInteger(source['latestVersion'])
    || source['latestVersion'] < 1
    || typeof source['latestSource'] !== 'string'
    || !DOCUMENT_SOURCES.has(source['latestSource'])
    || typeof source['latestLifecycle'] !== 'string'
    || !DOCUMENT_LIFECYCLE_STATES.has(source['latestLifecycle'])
    || typeof source['latestRetention'] !== 'string'
    || !DOCUMENT_RETENTION_STATES.has(source['latestRetention'])
    || typeof source['versionCount'] !== 'number'
    || !Number.isSafeInteger(source['versionCount'])
    || source['versionCount'] < 1
  ) {
    return undefined;
  }
  const safe: Record<string, unknown> = {
    documentFamilyId: source['documentFamilyId'].toLowerCase(),
    jobId: source['jobId'],
    documentType: source['documentType'],
    latestDocumentId: source['latestDocumentId'].toLowerCase(),
    latestVersion: source['latestVersion'],
    latestSource: source['latestSource'],
    latestLifecycle: source['latestLifecycle'],
    latestRetention: source['latestRetention'],
    versionCount: source['versionCount'],
  };
  const currentDocumentId = source['currentDocumentId'];
  const currentVersion = source['currentVersion'];
  if (currentDocumentId !== undefined || currentVersion !== undefined) {
    if (
      typeof currentDocumentId !== 'string'
      || !validUuid(currentDocumentId)
      || typeof currentVersion !== 'number'
      || !Number.isSafeInteger(currentVersion)
      || currentVersion < 1
    ) {
      return undefined;
    }
    safe['currentDocumentId'] = currentDocumentId.toLowerCase();
    safe['currentVersion'] = currentVersion;
  }
  for (const field of ['createdAt', 'updatedAt']) {
    const timestamp = safeTimestamp(source[field]);
    if (timestamp) safe[field] = timestamp;
  }
  return safe;
}

function safeDocumentFamilyPage(body: string): Record<string, unknown> | undefined {
  const source = parsedJson(body);
  if (
    !source
    || !Array.isArray(source['items'])
    || source['items'].length > 100
    || !['page', 'size', 'totalElements', 'totalPages'].every(field =>
      typeof source[field] === 'number'
      && Number.isSafeInteger(source[field])
      && Number(source[field]) >= 0)
  ) {
    return undefined;
  }
  const items = source['items'].map(safeDocumentFamilySummary);
  if (items.some(item => !item)) return undefined;
  return {
    items,
    page: source['page'],
    size: source['size'],
    totalElements: source['totalElements'],
    totalPages: source['totalPages'],
  };
}

function safeDocumentFamilyHistory(body: string): Record<string, unknown> | undefined {
  const source = parsedJson(body);
  if (
    !source
    || typeof source['documentFamilyId'] !== 'string'
    || !validUuid(source['documentFamilyId'])
    || typeof source['jobId'] !== 'string'
    || source['jobId'].length < 1
    || source['jobId'].length > 2_048
    || typeof source['documentType'] !== 'string'
    || !DOCUMENT_TYPES.has(source['documentType'])
    || !Array.isArray(source['versions'])
    || source['versions'].length > 1_000
  ) {
    return undefined;
  }
  const versions = source['versions'].map(safeDocumentVersionHistoryItem);
  if (versions.some(item => !item)) return undefined;
  const safe: Record<string, unknown> = {
    documentFamilyId: source['documentFamilyId'].toLowerCase(),
    jobId: source['jobId'],
    documentType: source['documentType'],
    versions,
  };
  const currentDocumentId = source['currentDocumentId'];
  const currentVersion = source['currentVersion'];
  if (currentDocumentId !== undefined || currentVersion !== undefined) {
    if (
      typeof currentDocumentId !== 'string'
      || !validUuid(currentDocumentId)
      || typeof currentVersion !== 'number'
      || !Number.isSafeInteger(currentVersion)
      || currentVersion < 1
    ) return undefined;
    safe['currentDocumentId'] = currentDocumentId.toLowerCase();
    safe['currentVersion'] = currentVersion;
  }
  return safe;
}

function selectFamilyCurrentBody(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const state = source['expectedCurrentState'];
  const expectedKeys = state === 'SELECTED'
    ? ['documentId', 'expectedCurrentState', 'expectedCurrentDocumentId']
    : ['documentId', 'expectedCurrentState'];
  if (
    !exactObjectKeys(value, expectedKeys)
    || typeof source['documentId'] !== 'string'
    || !validUuid(source['documentId'])
    || !['NONE', 'SELECTED'].includes(String(state))
  ) return undefined;
  const safe: Record<string, unknown> = {
    documentId: source['documentId'].toLowerCase(),
    expectedCurrentState: state,
  };
  if (state === 'SELECTED') {
    const expected = source['expectedCurrentDocumentId'];
    if (typeof expected !== 'string' || !validUuid(expected)) return undefined;
    safe['expectedCurrentDocumentId'] = expected.toLowerCase();
  }
  return safe;
}

function safeDocumentFamilyCurrent(body: string): Record<string, unknown> | undefined {
  const source = parsedJson(body);
  if (
    !source
    || typeof source['commandId'] !== 'string'
    || !validUuid(source['commandId'])
    || typeof source['documentFamilyId'] !== 'string'
    || !validUuid(source['documentFamilyId'])
    || typeof source['currentDocumentId'] !== 'string'
    || !validUuid(source['currentDocumentId'])
    || typeof source['currentVersion'] !== 'number'
    || !Number.isSafeInteger(source['currentVersion'])
    || source['currentVersion'] < 1
  ) return undefined;
  const changedAt = safeTimestamp(source['changedAt']);
  if (!changedAt) return undefined;
  return {
    commandId: source['commandId'].toLowerCase(),
    documentFamilyId: source['documentFamilyId'].toLowerCase(),
    currentDocumentId: source['currentDocumentId'].toLowerCase(),
    currentVersion: source['currentVersion'],
    changedAt,
  };
}

function safeApplicationSelectionRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (
    typeof source['id'] !== 'string'
    || !validUuid(source['id'])
    || typeof source['status'] !== 'string'
    || !APPLICATION_STATES.has(source['status'])
    || typeof source['version'] !== 'number'
    || !Number.isSafeInteger(source['version'])
    || source['version'] < 0
  ) {
    return undefined;
  }

  const safe: Record<string, unknown> = {
    id: source['id'].toLowerCase(),
    status: source['status'],
    version: source['version'],
  };
  for (const key of ['cvDocumentId', 'coverLetterDocumentId']) {
    const candidate = source[key];
    if (typeof candidate === 'string' && validUuid(candidate)) {
      safe[key] = candidate.toLowerCase();
    }
  }
  for (const key of ['cvDocumentReference', 'coverLetterDocumentReference']) {
    const candidate = safeApplicationDocumentReference(source[key]);
    if (candidate) safe[key] = candidate;
  }
  return safe;
}

function safeApplicationDocumentReference(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (
    typeof source['documentId'] !== 'string'
    || !validUuid(source['documentId'])
    || typeof source['documentFamilyId'] !== 'string'
    || !validUuid(source['documentFamilyId'])
    || typeof source['documentType'] !== 'string'
    || !DOCUMENT_TYPES.has(source['documentType'])
    || typeof source['version'] !== 'number'
    || !Number.isSafeInteger(source['version'])
    || source['version'] < 1
  ) {
    return undefined;
  }
  const safe: Record<string, unknown> = {
    documentId: source['documentId'].toLowerCase(),
    documentFamilyId: source['documentFamilyId'].toLowerCase(),
    documentType: source['documentType'],
    version: source['version'],
  };
  if (typeof source['jobId'] === 'string' && source['jobId'].length <= 2_048) {
    safe['jobId'] = source['jobId'];
  }
  if (
    typeof source['groundingState'] === 'string'
    && source['groundingState'].length <= 128
  ) {
    safe['groundingState'] = source['groundingState'];
  }
  if (
    typeof source['parentDocumentId'] === 'string'
    && validUuid(source['parentDocumentId'])
  ) {
    safe['parentDocumentId'] = source['parentDocumentId'].toLowerCase();
  }
  if (
    typeof source['parentDocumentVersion'] === 'number'
    && Number.isSafeInteger(source['parentDocumentVersion'])
    && source['parentDocumentVersion'] > 0
  ) {
    safe['parentDocumentVersion'] = source['parentDocumentVersion'];
  }
  return safe;
}

function parsedJson(body: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(body) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function safeOperationDownloads(value: unknown): Record<string, object> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const downloads: Record<string, object> = {};
  for (const purpose of ['cv', 'coverLetter']) {
    const group = (value as Record<string, unknown>)[purpose];
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
    const exports = (group as {exports?: unknown}).exports;
    if (!Array.isArray(exports)) continue;
    const safeExports = exports.flatMap(candidate => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
      const item = candidate as Record<string, unknown>;
      if (
        typeof item['fileId'] !== 'string'
        || !validUuid(item['fileId'])
        || !['DOCX', 'PDF'].includes(String(item['format']))
      ) {
        return [];
      }
      return [{
        fileId: item['fileId'].toLowerCase(),
        format: item['format'],
        ...(safeFileName(item['fileName']) ? {fileName: safeFileName(item['fileName'])} : {}),
      }];
    });
    downloads[purpose] = {exports: safeExports};
  }
  return Object.keys(downloads).length ? downloads : undefined;
}

function safeOperationPayload(body: string): Record<string, unknown> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (
    typeof source['operationId'] !== 'string'
    || !validUuid(source['operationId'])
    || typeof source['state'] !== 'string'
    || !OPERATION_STATES.has(source['state'])
  ) {
    return undefined;
  }

  const payload: Record<string, unknown> = {
    operationId: source['operationId'].toLowerCase(),
    state: source['state'],
  };
  for (const key of [
    'savedJobId',
    'cvDocumentId',
    'coverLetterDocumentId',
    'applicationId',
  ]) {
    const candidate = source[key];
    if (typeof candidate === 'string' && validUuid(candidate)) {
      payload[key] = candidate.toLowerCase();
    }
  }
  for (const key of ['replaySafe', 'manualActionRequired']) {
    if (typeof source[key] === 'boolean') payload[key] = source[key];
  }
  if (
    typeof source['failureCode'] === 'string'
    && FAILURE_CODE.test(source['failureCode'])
  ) {
    payload['failureCode'] = source['failureCode'];
  }
  for (const key of ['deadlineAt', 'createdAt', 'updatedAt']) {
    const timestamp = safeTimestamp(source[key]);
    if (timestamp) payload[key] = timestamp;
  }
  const downloads = safeOperationDownloads(source['downloads']);
  if (downloads) payload['downloads'] = downloads;
  return payload;
}

function stableOperationFailure(status: number, body: string): {
  error: string;
  message: string;
} {
  let upstreamCode: string | undefined;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const candidate = parsed['error'] ?? parsed['code'] ?? parsed['failureCode'];
    if (typeof candidate === 'string' && FAILURE_CODE.test(candidate)) {
      upstreamCode = candidate;
    }
  } catch {
    // Downstream bodies are deliberately not reflected to the browser.
  }

  if (upstreamCode === 'REQUEST_FORBIDDEN') {
    return {
      error: 'REQUEST_FORBIDDEN',
      message: 'A valid CSRF token is required',
    };
  }
  if (upstreamCode === 'SESSION_REQUIRED') {
    return {
      error: 'SESSION_REQUIRED',
      message: 'An authenticated browser session is required',
    };
  }
  if (status === 401 || status === 403) {
    return {
      error: 'GENERATION_AUTH_REQUIRED',
      message: 'Your session is not authorised for document generation',
    };
  }
  if (status === 402 || upstreamCode?.includes('CREDIT') || upstreamCode?.includes('QUOTA')) {
    return {
      error: 'GENERATION_QUOTA_EXHAUSTED',
      message: 'Document generation credit is not available',
    };
  }
  if (status === 429 || upstreamCode?.includes('RATE_LIMIT')) {
    return {
      error: 'GENERATION_RATE_LIMITED',
      message: 'Document generation is temporarily rate limited',
    };
  }
  if (status === 409) {
    return {
      error: upstreamCode === 'GENERATION_OUTCOME_UNKNOWN'
        ? 'GENERATION_OUTCOME_UNKNOWN'
        : 'GENERATION_CONFLICT',
      message: upstreamCode === 'GENERATION_OUTCOME_UNKNOWN'
        ? 'The provider outcome is unknown; no automatic retry was made'
        : 'The generation operation changed and must be refreshed',
    };
  }
  if (status === 404) {
    return {
      error: 'GENERATION_OPERATION_NOT_FOUND',
      message: 'The generation operation was not found for this session',
    };
  }
  if (status === 422 || upstreamCode?.includes('EVIDENCE')) {
    return {
      error: 'GENERATION_EVIDENCE_CHANGED',
      message: 'Selected evidence changed and must be reviewed',
    };
  }
  if (status === 503 || upstreamCode?.includes('DISABLED')) {
    return {
      error: 'GENERATION_DISABLED',
      message: 'Document generation is currently unavailable',
    };
  }
  return {
    error: 'GENERATION_REQUEST_REJECTED',
    message: 'The document generation request could not be completed',
  };
}

function sendPayload(response: Response, payload: ProxyPayload | undefined): void {
  response.setHeader('Cache-Control', 'private, no-store');
  if (!payload) {
    sendFailure(
      response,
      502,
      'INVALID_DOWNSTREAM_RESPONSE',
      'The document service returned an invalid response',
    );
    return;
  }
  response.status(payload.status).type(payload.contentType).send(payload.body);
}

function multipartType(request: Request): string | undefined {
  const contentType = request.get('Content-Type')?.trim();
  return contentType
    && contentType.length <= 256
    && MULTIPART_CONTENT_TYPE.test(contentType)
    ? contentType
    : undefined;
}

async function boundedRequestBody(
  request: Request,
  maximumBytes: number,
): Promise<Buffer> {
  const declaredLength = request.get('Content-Length');
  if (
    declaredLength
    && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw new RequestTooLargeError('Upload exceeds the allowed size');
  }

  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.length;
    if (receivedBytes > maximumBytes) {
      throw new RequestTooLargeError('Upload exceeds the allowed size');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, receivedBytes);
}

function safeFileName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalised = [...value.trim()]
    .filter(character => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127;
    })
    .join('');
  return normalised && normalised.length <= 255 ? normalised : undefined;
}

function downloadMetadata(value: unknown): {
  fileId: string;
  downloadUrl: string;
  fileName?: string;
} | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const file = value as {id?: unknown; fileName?: unknown};
  if (typeof file.id !== 'string' || !validUuid(file.id)) return undefined;
  return {
    fileId: file.id.toLowerCase(),
    downloadUrl: `/api/v1/document-generation/files/${file.id.toLowerCase()}/download`,
    fileName: safeFileName(file.fileName),
  };
}

function approvedDownloadHeaders(headers: Headers): DownloadHeaders | undefined {
  const contentType = headers
    .get('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase();
  const contentDisposition = headers.get('content-disposition')?.trim();
  const contentLengthValue = headers.get('content-length')?.trim();
  const xContentTypeOptions = headers.get('x-content-type-options')?.trim();
  const cacheControl = headers.get('cache-control')?.trim();
  const pragma = headers.get('pragma')?.trim();
  const cacheDirectives = new Set(
    cacheControl?.split(',').map(value => value.trim().toLowerCase()),
  );

  if (
    !contentType
    || !SAFE_DOWNLOAD_TYPES.has(contentType)
    || !contentDisposition
    || contentDisposition.length > 512
    || !/^attachment(?:;|$)/i.test(contentDisposition)
    || /[\r\n]/.test(contentDisposition)
    || !contentLengthValue
    || !/^\d+$/.test(contentLengthValue)
    || !Number.isSafeInteger(Number(contentLengthValue))
    || Number(contentLengthValue) < 0
    || xContentTypeOptions?.toLowerCase() !== 'nosniff'
    || !cacheControl
    || !cacheDirectives.has('private')
    || !cacheDirectives.has('no-store')
    || !cacheDirectives.has('max-age=0')
    || pragma?.toLowerCase() !== 'no-cache'
  ) {
    return undefined;
  }

  return {
    cacheControl,
    contentDisposition,
    contentLength: Number(contentLengthValue),
    contentType,
    pragma,
    xContentTypeOptions,
  };
}

async function proxyExactArtifactDownload(
  request: Request,
  response: Response,
  config: DocumentGenerationProxyConfig,
  documentId: string,
  artifactId: string,
  fetchImplementation: typeof fetch,
): Promise<void> {
  const credentials = jobFinderCredentials(request.headers, config, false, false);
  if ('status' in credentials) {
    sendFailure(response, credentials.status, credentials.error, credentials.message);
    return;
  }

  try {
    const {body, response: upstream} = await fetchAndConsumeWithTimeout(
      `${config.origin}/api/v1/document-generation/documents/${documentId}/artifacts/${artifactId}/download`,
      {method: 'GET', headers: credentials.headers},
      config.timeoutMs,
      async downstream => {
        const headers = downstream.ok
          ? approvedDownloadHeaders(downstream.headers)
          : undefined;
        return {
          body: headers ? await downstream.arrayBuffer() : undefined,
          response: downstream,
        };
      },
      fetchImplementation,
    );

    if (!upstream.ok) {
      sendFailure(
        response,
        upstream.status,
        'DOCUMENT_ARTIFACT_DOWNLOAD_FAILED',
        'The document artifact could not be downloaded',
      );
      return;
    }

    const headers = approvedDownloadHeaders(upstream.headers);
    if (!headers || !body || body.byteLength !== headers.contentLength) {
      sendFailure(
        response,
        502,
        'INVALID_DOWNSTREAM_RESPONSE',
        'The document service returned an invalid file',
      );
      return;
    }

    response.setHeader('Cache-Control', headers.cacheControl);
    response.setHeader('Content-Disposition', headers.contentDisposition);
    response.setHeader('Content-Length', String(headers.contentLength));
    response.setHeader('Content-Type', headers.contentType);
    response.setHeader('Pragma', headers.pragma);
    response.setHeader('X-Content-Type-Options', headers.xContentTypeOptions);
    response.status(200).send(Buffer.from(body));
  } catch (error: unknown) {
    const category = downstreamFailureCategory(error);
    console.error('BFF downstream request failed', {
      category,
      service: 'document-artifact-download',
    });
    sendFailure(
      response,
      category === 'timeout' ? 504 : 503,
      category === 'timeout' ? 'DOWNSTREAM_TIMEOUT' : 'SERVICE_UNAVAILABLE',
      category === 'timeout'
        ? 'Document artifact download timed out'
        : 'Document artifact download is currently unavailable',
    );
  }
}

export function registerDocumentGenerationRoutes(
  app: Express,
  config: DocumentGenerationProxyConfig,
  fetchImplementation: typeof fetch = fetch,
): void {
  const proxyJson = async (
    request: Request,
    response: Response,
    origin: string,
    path: string,
    method: 'GET' | 'POST',
    requiresCsrf: boolean,
    additionalHeaders: Record<string, string> = {},
  ): Promise<void> => {
    try {
      sendPayload(
        response,
        await callJson(
          config,
          origin,
          path,
          request,
          method,
          requiresCsrf,
          fetchImplementation,
          additionalHeaders,
        ),
      );
    } catch (error: unknown) {
      const category = downstreamFailureCategory(error);
      console.error('BFF downstream request failed', {
        category,
        service: 'document-generation',
      });
      sendFailure(
        response,
        category === 'timeout' ? 504 : 503,
        category === 'timeout' ? 'DOWNSTREAM_TIMEOUT' : 'SERVICE_UNAVAILABLE',
        category === 'timeout'
          ? 'Document generation timed out'
          : 'Document generation is currently unavailable',
      );
    }
  };

  const proxyOperation = async (
    request: Request,
    response: Response,
    path: string,
    method: JsonMethod,
    requiresCsrf: boolean,
    additionalHeaders: Record<string, string> = {},
  ): Promise<void> => {
    const correlationId = requestCorrelationId(request);
    response.setHeader('X-Correlation-ID', correlationId);
    try {
      const payload = await callJson(
        config,
        config.origin,
        path,
        request,
        method,
        requiresCsrf,
        fetchImplementation,
        {
          ...additionalHeaders,
          'X-Correlation-ID': correlationId,
        },
      );
      response.setHeader('Cache-Control', 'private, no-store');
      if (!payload) {
        sendFailure(
          response,
          502,
          'INVALID_DOWNSTREAM_RESPONSE',
          'The document service returned an invalid response',
        );
        return;
      }
      if (payload.status < 200 || payload.status >= 300) {
        const failure = stableOperationFailure(payload.status, payload.body);
        sendFailure(response, payload.status, failure.error, failure.message);
        return;
      }
      const operation = safeOperationPayload(payload.body);
      if (!operation) {
        sendFailure(
          response,
          502,
          'INVALID_DOWNSTREAM_RESPONSE',
          'The document service returned an invalid operation',
        );
        return;
      }
      response.status(payload.status).json(operation);
    } catch (error: unknown) {
      const category = downstreamFailureCategory(error);
      console.error('BFF downstream request failed', {
        category,
        correlationId,
        service: 'document-generation-operation',
      });
      sendFailure(
        response,
        category === 'timeout' ? 504 : 503,
        category === 'timeout' ? 'GENERATION_TIMEOUT' : 'GENERATION_DISABLED',
        category === 'timeout'
          ? 'The document generation request timed out; its outcome may still be processing'
          : 'Document generation is currently unavailable',
      );
    }
  };

  const proxyApplicationSelections = async (
    request: Request,
    response: Response,
    path: string,
    idempotencyKey: string,
  ): Promise<void> => {
    const correlationId = requestCorrelationId(request);
    response.setHeader('X-Correlation-ID', correlationId);
    response.setHeader('Cache-Control', 'private, no-store');
    try {
      const payload = await callJson(
        config,
        config.origin,
        path,
        request,
        'PUT',
        true,
        fetchImplementation,
        {
          'Idempotency-Key': idempotencyKey,
          'X-Correlation-ID': correlationId,
        },
      );
      if (!payload) {
        sendFailure(
          response,
          502,
          'INVALID_DOWNSTREAM_RESPONSE',
          'The document service returned an invalid response',
        );
        return;
      }

      const source = parsedJson(payload.body);
      if (payload.status === 409 && source) {
        const currentApplication = safeApplicationSelectionRecord(
          source['currentApplication'],
        );
        if (currentApplication) {
          response.status(409).json({
            status: 409,
            message: 'The application changed; review the current selections before saving again',
            currentApplication,
          });
          return;
        }
      }

      if (payload.status < 200 || payload.status >= 300) {
        const error = payload.status === 401 || payload.status === 403
          ? 'DOCUMENT_SELECTION_AUTH_REQUIRED'
          : payload.status === 404
            ? 'APPLICATION_NOT_FOUND'
            : payload.status === 409
              ? 'DOCUMENT_SELECTION_CONFLICT'
              : 'DOCUMENT_SELECTION_REJECTED';
        const message = payload.status === 401 || payload.status === 403
          ? 'Your session is not authorised to change this application'
          : payload.status === 404
            ? 'The application was not found for this session'
            : payload.status === 409
              ? 'The selection request conflicts with an earlier request'
              : 'The document selections could not be saved';
        sendFailure(response, payload.status, error, message);
        return;
      }

      const application = safeApplicationSelectionRecord(source);
      if (!application) {
        sendFailure(
          response,
          502,
          'INVALID_DOWNSTREAM_RESPONSE',
          'The document service returned an invalid application record',
        );
        return;
      }
      response.status(payload.status).json(application);
    } catch (error: unknown) {
      const category = downstreamFailureCategory(error);
      console.error('BFF downstream request failed', {
        category,
        correlationId,
        service: 'application-document-selections',
      });
      sendFailure(
        response,
        category === 'timeout' ? 504 : 503,
        category === 'timeout' ? 'DOWNSTREAM_TIMEOUT' : 'SERVICE_UNAVAILABLE',
        category === 'timeout'
          ? 'Saving document selections timed out; review the application before retrying'
          : 'Document selections are currently unavailable',
      );
    }
  };

  const proxyDocumentLifecycle = async (
    request: Request,
    response: Response,
    path: string,
    method: 'DELETE' | 'GET' | 'PATCH',
  ): Promise<void> => {
    const correlationId = requestCorrelationId(request);
    response.setHeader('X-Correlation-ID', correlationId);
    response.setHeader('Cache-Control', 'private, no-store');
    try {
      const payload = await callJson(
        config,
        config.origin,
        path,
        request,
        method,
        method !== 'GET',
        fetchImplementation,
        {'X-Correlation-ID': correlationId},
      );
      if (!payload) {
        sendFailure(
          response,
          502,
          'INVALID_DOWNSTREAM_RESPONSE',
          'The document service returned an invalid response',
        );
        return;
      }
      if (payload.status < 200 || payload.status >= 300) {
        const error = payload.status === 401 || payload.status === 403
          ? 'DOCUMENT_LIFECYCLE_AUTH_REQUIRED'
          : payload.status === 404
            ? 'DOCUMENT_VERSION_NOT_FOUND'
            : payload.status === 409
              ? 'DOCUMENT_LIFECYCLE_CONFLICT'
              : 'DOCUMENT_LIFECYCLE_REJECTED';
        const message = payload.status === 401 || payload.status === 403
          ? 'Your session is not authorised to manage this document version'
          : payload.status === 404
            ? 'The document version was not found for this session'
            : payload.status === 409
              ? 'The document lifecycle changed or could not be coordinated safely'
              : 'The document lifecycle request could not be completed';
        sendFailure(response, payload.status, error, message);
        return;
      }
      if (method === 'DELETE' && payload.status === 204) {
        response.status(204).send();
        return;
      }

      const safe = method === 'GET'
        ? safeDocumentAssociationsPayload(payload.body)
        : safeDocumentLifecyclePayload(payload.body);
      if (!safe) {
        sendFailure(
          response,
          502,
          'INVALID_DOWNSTREAM_RESPONSE',
          'The document service returned an invalid lifecycle response',
        );
        return;
      }
      response.status(payload.status).json(safe);
    } catch (error: unknown) {
      const category = downstreamFailureCategory(error);
      console.error('BFF downstream request failed', {
        category,
        correlationId,
        service: 'document-lifecycle',
      });
      sendFailure(
        response,
        category === 'timeout' ? 504 : 503,
        category === 'timeout' ? 'DOWNSTREAM_TIMEOUT' : 'SERVICE_UNAVAILABLE',
        category === 'timeout'
          ? 'The document lifecycle request timed out; refresh before retrying'
          : 'Document lifecycle is currently unavailable',
      );
    }
  };

  const proxyDocumentFamilyRead = async (
    request: Request,
    response: Response,
    path: string,
    kind: 'history' | 'page',
  ): Promise<void> => {
    const correlationId = requestCorrelationId(request);
    response.setHeader('X-Correlation-ID', correlationId);
    response.setHeader('Cache-Control', 'private, no-store');
    try {
      const payload = await callJson(
        config,
        config.origin,
        path,
        request,
        'GET',
        false,
        fetchImplementation,
        {'X-Correlation-ID': correlationId},
      );
      if (!payload) {
        sendFailure(response, 502, 'INVALID_DOWNSTREAM_RESPONSE', 'The document service returned an invalid response');
        return;
      }
      if (payload.status < 200 || payload.status >= 300) {
        sendFailure(
          response,
          payload.status,
          payload.status === 401 || payload.status === 403
            ? 'DOCUMENT_HISTORY_AUTH_REQUIRED'
            : payload.status === 404
              ? 'DOCUMENT_FAMILY_NOT_FOUND'
              : 'DOCUMENT_HISTORY_REJECTED',
          payload.status === 404
            ? 'The document family was not found for this session'
            : 'Document history is currently unavailable',
        );
        return;
      }
      const safe = kind === 'page'
        ? safeDocumentFamilyPage(payload.body)
        : safeDocumentFamilyHistory(payload.body);
      if (!safe) {
        sendFailure(response, 502, 'INVALID_DOWNSTREAM_RESPONSE', 'The document service returned invalid document history');
        return;
      }
      response.status(payload.status).json(safe);
    } catch (error: unknown) {
      const category = downstreamFailureCategory(error);
      console.error('BFF downstream request failed', {
        category,
        correlationId,
        service: 'document-family-history',
      });
      sendFailure(
        response,
        category === 'timeout' ? 504 : 503,
        category === 'timeout' ? 'DOWNSTREAM_TIMEOUT' : 'SERVICE_UNAVAILABLE',
        category === 'timeout'
          ? 'Document history timed out'
          : 'Document history is currently unavailable',
      );
    }
  };

  app.get('/api/v1/document-generation/document-families', async (request, response) => {
    const page = request.query['page'] === undefined ? 0 : Number(request.query['page']);
    const size = request.query['size'] === undefined ? 20 : Number(request.query['size']);
    if (
      !Number.isSafeInteger(page)
      || page < 0
      || !Number.isSafeInteger(size)
      || size < 1
      || size > 100
    ) {
      sendFailure(response, 400, 'INVALID_DOCUMENT_PAGE', 'Document page and size are invalid');
      return;
    }
    await proxyDocumentFamilyRead(
      request,
      response,
      `/api/v1/document-generation/document-families?page=${page}&size=${size}`,
      'page',
    );
  });

  app.get('/api/v1/document-generation/document-families/:documentFamilyId', async (request, response) => {
    const familyId = request.params['documentFamilyId'];
    if (!validUuid(familyId)) {
      sendFailure(response, 400, 'INVALID_DOCUMENT_FAMILY_ID', 'The document family identifier is invalid');
      return;
    }
    await proxyDocumentFamilyRead(
      request,
      response,
      `/api/v1/document-generation/document-families/${familyId.toLowerCase()}`,
      'history',
    );
  });

  app.patch('/api/v1/document-generation/document-families/:documentFamilyId/current', async (request, response) => {
    const familyId = request.params['documentFamilyId'];
    const idempotencyKey = request.get('Idempotency-Key')?.trim();
    const body = selectFamilyCurrentBody(request.body);
    if (!validUuid(familyId)) {
      sendFailure(response, 400, 'INVALID_DOCUMENT_FAMILY_ID', 'The document family identifier is invalid');
      return;
    }
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      sendFailure(response, 400, 'INVALID_IDEMPOTENCY_KEY', 'A valid idempotency key is required');
      return;
    }
    if (!body) {
      sendFailure(response, 400, 'INVALID_CURRENT_SELECTION', 'The current document selection is invalid');
      return;
    }
    request.body = body;
    const correlationId = requestCorrelationId(request);
    response.setHeader('X-Correlation-ID', correlationId);
    response.setHeader('Cache-Control', 'private, no-store');
    try {
      const payload = await callJson(
        config,
        config.origin,
        `/api/v1/document-generation/document-families/${familyId.toLowerCase()}/current`,
        request,
        'PATCH',
        true,
        fetchImplementation,
        {'Idempotency-Key': idempotencyKey, 'X-Correlation-ID': correlationId},
        true,
      );
      if (!payload) {
        sendFailure(response, 502, 'INVALID_DOWNSTREAM_RESPONSE', 'The document service returned an invalid response');
        return;
      }
      if (payload.status < 200 || payload.status >= 300) {
        sendFailure(
          response,
          payload.status,
          payload.status === 409 ? 'DOCUMENT_CURRENT_CONFLICT' : 'DOCUMENT_CURRENT_REJECTED',
          payload.status === 409
            ? 'The current document changed; refresh and review before retrying'
            : 'The current document could not be changed',
        );
        return;
      }
      const safe = safeDocumentFamilyCurrent(payload.body);
      if (!safe) {
        sendFailure(response, 502, 'INVALID_DOWNSTREAM_RESPONSE', 'The document service returned an invalid current selection');
        return;
      }
      response.status(payload.status).json(safe);
    } catch (error: unknown) {
      const category = downstreamFailureCategory(error);
      console.error('BFF downstream request failed', {
        category,
        correlationId,
        service: 'document-family-current',
      });
      sendFailure(
        response,
        category === 'timeout' ? 504 : 503,
        category === 'timeout' ? 'DOWNSTREAM_TIMEOUT' : 'SERVICE_UNAVAILABLE',
        'The current document could not be changed; refresh before retrying',
      );
    }
  });

  app.get('/api/v1/document-generation/document-versions/:documentId/application-associations', async (request, response) => {
    const documentId = request.params['documentId'];
    if (!validUuid(documentId)) {
      sendFailure(
        response,
        400,
        'INVALID_DOCUMENT_ID',
        'The document version identifier is invalid',
      );
      return;
    }
    await proxyDocumentLifecycle(
      request,
      response,
      `/api/v1/document-generation/document-versions/${documentId.toLowerCase()}/application-associations`,
      'GET',
    );
  });

  for (const action of ['archive', 'restore'] as const) {
    app.patch(`/api/v1/document-generation/document-versions/:documentId/${action}`, async (request, response) => {
      const documentId = request.params['documentId'];
      if (!validUuid(documentId)) {
        sendFailure(
          response,
          400,
          'INVALID_DOCUMENT_ID',
          'The document version identifier is invalid',
        );
        return;
      }
      await proxyDocumentLifecycle(
        request,
        response,
        `/api/v1/document-generation/document-versions/${documentId.toLowerCase()}/${action}`,
        'PATCH',
      );
    });
  }

  app.delete('/api/v1/document-generation/document-versions/:documentId', async (request, response) => {
    const documentId = request.params['documentId'];
    if (!validUuid(documentId)) {
      sendFailure(
        response,
        400,
        'INVALID_DOCUMENT_ID',
        'The document version identifier is invalid',
      );
      return;
    }
    await proxyDocumentLifecycle(
      request,
      response,
      `/api/v1/document-generation/document-versions/${documentId.toLowerCase()}`,
      'DELETE',
    );
  });

  app.put('/api/v1/document-generation/applications/:applicationId/document-selections', async (request, response) => {
    const applicationId = request.params['applicationId'];
    const idempotencyKey = request.get('Idempotency-Key')?.trim();
    if (!validUuid(applicationId)) {
      sendFailure(
        response,
        400,
        'INVALID_APPLICATION_ID',
        'The application identifier is invalid',
      );
      return;
    }
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      sendFailure(
        response,
        400,
        'INVALID_IDEMPOTENCY_KEY',
        'A valid idempotency key is required',
      );
      return;
    }
    const body = saveDocumentSelectionsBody(request.body);
    if (!body) {
      sendFailure(
        response,
        400,
        'INVALID_DOCUMENT_SELECTIONS',
        'Both document slots and a non-negative expected version are required',
      );
      return;
    }
    request.body = body;
    await proxyApplicationSelections(
      request,
      response,
      `/api/v1/document-generation/applications/${applicationId.toLowerCase()}/document-selections`,
      idempotencyKey,
    );
  });

  app.post('/api/v1/document-generation/saved-jobs/:savedJobId/operations', async (request, response) => {
    const savedJobId = request.params['savedJobId'];
    const idempotencyKey = request.get('Idempotency-Key')?.trim();
    if (!validUuid(savedJobId)) {
      sendFailure(response, 400, 'INVALID_SAVED_JOB_ID', 'The saved job identifier is invalid');
      return;
    }
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      sendFailure(response, 400, 'INVALID_IDEMPOTENCY_KEY', 'A valid idempotency key is required');
      return;
    }
    const body = startGenerationBody(request.body);
    if (!body) {
      sendFailure(
        response,
        400,
        'INVALID_EVIDENCE_SELECTION',
        'Choose valid confirmed evidence separately for the CV and cover letter',
      );
      return;
    }
    request.body = body;
    await proxyOperation(
      request,
      response,
      `/api/v1/document-generation/saved-jobs/${savedJobId.toLowerCase()}/operations`,
      'POST',
      true,
      {'Idempotency-Key': idempotencyKey},
    );
  });

  app.post('/api/v1/document-generation/operations/:operationId/approve', async (request, response) => {
    const operationId = request.params['operationId'];
    if (!validUuid(operationId)) {
      sendFailure(response, 400, 'INVALID_OPERATION_ID', 'The generation operation identifier is invalid');
      return;
    }
    const body = approveGenerationBody(request.body);
    if (!body) {
      sendFailure(
        response,
        400,
        'INVALID_APPROVAL_REQUEST',
        'Valid distinct CV and cover letter document identifiers are required',
      );
      return;
    }
    request.body = body;
    await proxyOperation(
      request,
      response,
      `/api/v1/document-generation/operations/${operationId.toLowerCase()}/approve`,
      'POST',
      true,
    );
  });

  app.get('/api/v1/document-generation/operations/:operationId', async (request, response) => {
    const operationId = request.params['operationId'];
    if (!validUuid(operationId)) {
      sendFailure(response, 400, 'INVALID_OPERATION_ID', 'The generation operation identifier is invalid');
      return;
    }
    await proxyOperation(
      request,
      response,
      `/api/v1/document-generation/operations/${operationId.toLowerCase()}`,
      'GET',
      false,
    );
  });

  app.delete('/api/v1/document-generation/operations/:operationId', async (request, response) => {
    const operationId = request.params['operationId'];
    if (!validUuid(operationId)) {
      sendFailure(response, 400, 'INVALID_OPERATION_ID', 'The generation operation identifier is invalid');
      return;
    }
    await proxyOperation(
      request,
      response,
      `/api/v1/document-generation/operations/${operationId.toLowerCase()}`,
      'DELETE',
      true,
    );
  });

  app.post('/api/v1/document-generation/applications/:applicationId/replace', async (request, response) => {
    const applicationId = request.params['applicationId'];
    const documentType = request.query['documentType'];
    if (!validUuid(applicationId)) {
      sendFailure(
        response,
        400,
        'INVALID_APPLICATION_ID',
        'The application identifier is invalid',
      );
      return;
    }
    if (typeof documentType !== 'string' || !DOCUMENT_TYPES.has(documentType)) {
      sendFailure(
        response,
        400,
        'INVALID_DOCUMENT_TYPE',
        'The replacement document type is invalid',
      );
      return;
    }
    const contentType = multipartType(request);
    if (!contentType) {
      sendFailure(
        response,
        415,
        'INVALID_CONTENT_TYPE',
        'A multipart document upload is required',
      );
      return;
    }
    const credentials = jobFinderCredentials(
      request.headers,
      config,
      true,
      false,
    );
    if ('status' in credentials) {
      sendFailure(
        response,
        credentials.status,
        credentials.error,
        credentials.message,
      );
      return;
    }

    try {
      const body = await boundedRequestBody(request, MAX_MULTIPART_BYTES);
      const {body: payload, response: upstream} = await fetchTextWithTimeout(
        `${config.origin}/api/v1/document-generation/applications/${applicationId.toLowerCase()}/replace?documentType=${documentType}`,
        {
          method: 'POST',
          headers: {
            ...credentials.headers,
            'Content-Length': String(body.length),
            'Content-Type': contentType,
          },
          body: Uint8Array.from(body).buffer,
        },
        config.timeoutMs,
        fetchImplementation,
      );
      const accessToken = credentials.headers['Authorization'].slice('Bearer '.length);
      if (payload.includes(accessToken)) {
        sendPayload(response, undefined);
        return;
      }
      const upstreamType = upstream.headers
        .get('content-type')
        ?.split(';', 1)[0]
        .trim()
        .toLowerCase();
      sendPayload(response, {
        body: payload,
        contentType: upstreamType === 'application/problem+json'
          ? 'application/problem+json'
          : 'application/json',
        status: upstream.status,
      });
    } catch (error: unknown) {
      if (error instanceof RequestTooLargeError) {
        sendFailure(
          response,
          413,
          'REQUEST_TOO_LARGE',
          'The document upload exceeds the 25MB limit',
        );
        return;
      }
      const category = downstreamFailureCategory(error);
      console.error('BFF downstream request failed', {
        category,
        service: 'document-replacement',
      });
      sendFailure(
        response,
        category === 'timeout' ? 504 : 503,
        category === 'timeout' ? 'DOWNSTREAM_TIMEOUT' : 'SERVICE_UNAVAILABLE',
        category === 'timeout'
          ? 'Document replacement timed out'
          : 'Document replacement is currently unavailable',
      );
    }
  });

  app.get('/api/v1/document-generation/files/:fileId/download', async (request, response) => {
    const fileId = request.params['fileId'];
    if (!validUuid(fileId)) {
      sendFailure(response, 400, 'INVALID_FILE_ID', 'The document file identifier is invalid');
      return;
    }
    const credentials = jobFinderCredentials(request.headers, config, false, false);
    if ('status' in credentials) {
      sendFailure(response, credentials.status, credentials.error, credentials.message);
      return;
    }

    try {
      const {body, response: upstream} = await fetchAndConsumeWithTimeout(
        `${config.origin}/api/v1/document-generation/files/${fileId.toLowerCase()}/download`,
        {method: 'GET', headers: credentials.headers},
        config.timeoutMs,
        async downstream => {
          const contentType = downstream.headers
            .get('content-type')
            ?.split(';', 1)[0]
            .trim()
            .toLowerCase();
          const validDownload = downstream.ok
            && contentType !== undefined
            && SAFE_DOWNLOAD_TYPES.has(contentType);
          return {
            body: validDownload ? await downstream.arrayBuffer() : undefined,
            response: downstream,
          };
        },
        fetchImplementation,
      );
      response.setHeader('Cache-Control', 'private, no-store');
      const contentType = upstream.headers
        .get('content-type')
        ?.split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (!upstream.ok || !contentType || !SAFE_DOWNLOAD_TYPES.has(contentType)) {
        sendFailure(
          response,
          upstream.ok ? 502 : upstream.status,
          upstream.ok ? 'INVALID_DOWNSTREAM_RESPONSE' : 'DOCUMENT_DOWNLOAD_FAILED',
          upstream.ok
            ? 'The document service returned an invalid file'
            : 'The document could not be downloaded',
        );
        return;
      }
      if (!body) {
        sendFailure(
          response,
          502,
          'INVALID_DOWNSTREAM_RESPONSE',
          'The document service returned an invalid file',
        );
        return;
      }

      const contentDisposition = upstream.headers.get('content-disposition');
      if (
        contentDisposition
        && contentDisposition.length <= 512
        && !/[\r\n]/.test(contentDisposition)
      ) {
        response.setHeader('Content-Disposition', contentDisposition);
      }
      response.status(200).type(contentType).send(
        Buffer.from(body),
      );
    } catch (error: unknown) {
      const category = downstreamFailureCategory(error);
      console.error('BFF downstream request failed', {
        category,
        service: 'document-download',
      });
      sendFailure(
        response,
        category === 'timeout' ? 504 : 503,
        category === 'timeout' ? 'DOWNSTREAM_TIMEOUT' : 'SERVICE_UNAVAILABLE',
        category === 'timeout'
          ? 'Document download timed out'
          : 'Document download is currently unavailable',
      );
    }
  });

  app.get(
    '/api/v1/document-generation/documents/:documentId/artifacts/:artifactId/download',
    async (request, response) => {
      const documentId = request.params['documentId'];
      const artifactId = request.params['artifactId'];
      if (!validUuid(documentId) || !validUuid(artifactId)) {
        sendFailure(
          response,
          400,
          'INVALID_DOCUMENT_ARTIFACT_ID',
          'Valid document and artifact identifiers are required',
        );
        return;
      }
      await proxyExactArtifactDownload(
        request,
        response,
        config,
        documentId.toLowerCase(),
        artifactId.toLowerCase(),
        fetchImplementation,
      );
    },
  );

  app.get('/api/v1/document-generation/documents/:generatedDocumentId/files/latest', async (request, response) => {
    const documentId = request.params['generatedDocumentId'];
    if (!validUuid(documentId)) {
      sendFailure(response, 400, 'INVALID_DOCUMENT_ID', 'The document identifier is invalid');
      return;
    }
    try {
      const payload = await callJson(
        config,
        config.documentStoreOrigin,
        `/api/v1/documents/${documentId.toLowerCase()}/files/latest`,
        request,
        'GET',
        false,
        fetchImplementation,
      );
      if (!payload || payload.status !== 200) {
        sendPayload(response, payload);
        return;
      }
      const files = JSON.parse(payload.body) as {
        fileType?: unknown;
        active?: unknown;
      }[];
      if (!Array.isArray(files)) {
        sendPayload(response, undefined);
        return;
      }
      const activeFiles = files.filter(file => file.active !== false);
      response
        .status(200)
        .setHeader('Cache-Control', 'private, no-store')
        .json({
          docx: downloadMetadata(
            activeFiles.find(file => file.fileType === 'DOCX'),
          ),
          pdf: downloadMetadata(
            activeFiles.find(file => file.fileType === 'PDF'),
          ),
        });
    } catch (error: unknown) {
      const category = downstreamFailureCategory(error);
      console.error('BFF downstream request failed', {
        category,
        service: 'document-metadata',
      });
      sendFailure(
        response,
        category === 'timeout' ? 504 : 503,
        category === 'timeout' ? 'DOWNSTREAM_TIMEOUT' : 'SERVICE_UNAVAILABLE',
        category === 'timeout'
          ? 'Document metadata timed out'
          : 'Document metadata is currently unavailable',
      );
    }
  });

  for (const suffix of ['files/latest', 'files']) {
    app.get(`/api/v1/documents/:generatedDocumentId/${suffix}`, async (request, response) => {
      const documentId = request.params['generatedDocumentId'];
      if (!validUuid(documentId)) {
        sendFailure(response, 400, 'INVALID_DOCUMENT_ID', 'The document identifier is invalid');
        return;
      }
      await proxyJson(
        request,
        response,
        config.documentStoreOrigin,
        `/api/v1/documents/${documentId.toLowerCase()}/${suffix}`,
        'GET',
        false,
      );
    });
  }
}
