# ADR 0005: Translate the browser session only at the Job Finder BFF allowlist

- Status: Accepted for controlled private beta
- Date: 2026-07-27
- Decision owner: Job Seeker Copilot Client
- Upstream decisions: UMG ADR 0001 and client ADR 0002

## Context

UMG keeps RS256 access and refresh tokens in HttpOnly browser cookies. Angular
cannot read them and never supplies bearer identity. Job Finder Gateway 1.2.0
independently validates a Bearer access token and derives saved-job ownership
only from its subject.

The retained client proxy instead trusted browser `Authorization` and
`X-User-Id`. The `/api/jobs` deny boundary correctly made that code unreachable,
but it also left no safe route for the reviewed search and saved-job contract.

## Decision

The same-origin Express BFF is the only browser-facing component that translates
the UMG access cookie for Job Finder. It selects UMG's fixed local or production
cookie name from a validated profile and creates `Authorization: Bearer ...`
only in server request memory. The default is the explicit local HTTP developer
boundary; production deployment must select `production`, which has no
configurable fallback cookie names. The BFF does not issue, rotate, refresh,
persist, cache, inspect claims from, or log the token. Job Finder remains
responsible for signature, issuer, audience, expiry, token type and subject
validation.

Browser `Authorization`, `X-User-Id`, forwarding, hop-by-hop and unrelated
headers/cookies are never copied. POST search/save and DELETE unsave require the
UMG-owned double-submit CSRF cookie/header pair and compare it in constant time.
No write is automatically replayed after refresh.

The BFF registers exactly these operations before the existing `/api/jobs` deny
middleware:

| Browser method and path | Downstream operation |
|---|---|
| `POST /api/jobs/search` | Authenticated search |
| `POST /api/jobs/saved` | Save canonical snapshot |
| `GET /api/jobs/saved?page=&size=` | List the current owner's saved jobs |
| `GET /api/jobs/saved/{savedJobId}` | Get one owner-scoped snapshot |
| `DELETE /api/jobs/saved/{savedJobId}` | Unsave one owner-scoped snapshot |

Paging is normalised to Job Service's page/size bounds and IDs must be UUIDs.
All other Job Finder paths still reach the deny middleware before retained
handlers. Application Tracking, Document Generation, documents, reporting and
payment are unchanged and disabled.

Responses are always non-cacheable. Only status, JSON/problem content type and
the reviewed saved-job outcome header cross the boundary. Upstream cookies and
internal headers do not. A response that reflects the access token fails as a
stable `502`; timeouts and network failures are stable `504`/`503`. Operational
logs contain only `job-finder` and the fixed failure category.

## Consequences

The server boundary is ready for the later SEARCH-12 Angular journey without
putting bearer material in JavaScript or browser storage. Missing, malformed or
duplicate access cookies fail locally with `401`; invalid CSRF fails locally
with `403`; invalid query/path selectors fail locally with `400`.

The Angular Job Search UI remains disabled. It must use the existing in-memory
session decision, bootstrap CSRF before selected POST/DELETE requests, handle
expiry without replaying writes, and add accessible loading/empty/partial/
failure/save states plus browser evidence. Durable Document Generation needs a
separate reviewed BFF allowlist after its remaining service dependencies are
complete.

Production TLS termination, proxy trust, network policy and multi-instance UMG
refresh coordination remain platform responsibilities.
