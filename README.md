# Job Seeker Copilot Client

Angular 21 browser application with an Express SSR/BFF layer. In the selected
beta path it proxies authentication/profile requests to user-management-gateway
and postcode requests to location-gateway.

> Beta status: not beta-ready. Reproducible builds, browser token custody, and
> client session lifecycle are in place, while end-to-end readiness work
> remains. See [the audit](docs/BETA_READINESS_AUDIT.md).

## Prerequisites

- Node.js 24 (CI baseline)
- Java 17 or newer (OpenAPI Generator runtime)
- npm and the committed `package-lock.json`
- user-management-gateway on port 8083 and location-gateway on port 8081

Runtime configuration is supplied to the SSR process, not committed:

| Variable | Local default | Purpose |
|---|---|---|
| `PORT` | `3000` | SSR listen port |
| `HOST` | `0.0.0.0` | SSR listen host |
| `USER_MANAGEMENT_GATEWAY_URL` | `http://localhost:8083` | Auth/profile gateway |
| `LOCATION_GATEWAY_URL` | `http://location-gateway:8081` | Location gateway |
| `NG_ALLOWED_HOSTS` | local/container hosts | Comma-separated SSR hosts |
| `BFF_JSON_BODY_LIMIT_BYTES` | `65536` | Maximum parsed JSON request body (max 1 MiB) |
| `BFF_DOWNSTREAM_TIMEOUT_MS` | `5000` | UMG proxy deadline (max 60 seconds) |
| `BFF_REQUEST_TIMEOUT_MS` | `15000` | Node request timeout (max 120 seconds) |
| `BFF_HEADERS_TIMEOUT_MS` | `10000` | Node header timeout; cannot exceed request timeout |
| `BFF_KEEP_ALIVE_TIMEOUT_MS` | `5000` | Node idle keep-alive timeout (max 60 seconds) |

Never place provider or production credentials in Angular environment files;
browser bundles cannot keep a secret.

The SSR process validates these values before listening. The UMG setting must be
an HTTP(S) origin without credentials, a path, query or fragment. Hosts must be
explicit IP addresses or DNS names; wildcard host allowlists are rejected. All
numeric limits are positive bounded integers. Invalid configuration terminates
startup without printing the rejected value.

## Build and test

```bash
npm ci
npm run lint
npm test -- --watch=false
npm run build
```

Each command verifies the pinned contracts and regenerates ignored TypeScript
clients. `npm run api:verify` checks provenance without generating code. Contract
updates must change the versioned snapshot and `contracts/contracts.lock.json`
together, with evidence from the owning backend's contract tests.

The first generation downloads the pinned OpenAPI Generator JAR from Maven Central
into `.cache/`; its locked SHA-256 is verified before execution. See the
[dependency security baseline](docs/dependency-security.md) for audit policy and
current residual findings.

The selected User Management beta enables authentication, profile, and location
lookup only. Job finder, document generation, reporting, and payment UI source is
retained but disabled pending authoritative contracts and separate approval. See
[ADR 0001](docs/adr/0001-reproducible-beta-api-clients.md) and the
[browser-session ADR](docs/adr/0002-browser-session-client.md).

Express also fails closed before every retained legacy handler for `/api/jobs`,
`/api/v1/applications`, `/api/v1/document-generation`, `/api/v1/documents`,
`/api/v1/reports` and `/api/v1/payment`. These prefixes and all child paths return
the stable `404 FEATURE_NOT_AVAILABLE` beta response, regardless of method or
browser-supplied identity headers; no downstream request is made.

## Browser session security

The browser calls only same-origin `/api/auth/*` routes. Express forwards the
opaque browser cookies and `X-CSRF-Token` value to user-management-gateway and
relays each `Set-Cookie` response independently. It deliberately ignores
browser-supplied `Authorization`, `X-User-Id`, and profile identity selectors.
Access and refresh tokens remain in UMG-owned HttpOnly cookies and never enter
Angular state, browser storage, response models, logs, or generated source.

Registration, login, profile update, and logout first bootstrap CSRF through
`GET /api/auth/csrf`. Angular validates the fixed header name and holds the
random value only in application memory. Local HTTP cookie names and production
Secure `__Host-` names are owned by UMG; the client must not read them. On first
load the beta shell deletes all obsolete `jc_*` session/profile values from both
`localStorage` and `sessionStorage`.

UMG/Spring Security can replace the CSRF cookie when an authenticated security
context is established. After authentication, profile writes, and logout, the
client therefore discards its in-memory copy and bootstraps again before the next
write. It never retries a state-changing request automatically.

On startup the root beta shell displays no claimant PII until a subject-bound
profile read validates the cookie session. One shared refresh may run after a
401, followed by exactly one safe profile-read retry. Successful validation
restores the token-free user/profile state after reload. Final expiry clears all
in-memory PII and returns to sign-in; a network or 5xx failure instead displays a
retryable unavailable state without claiming logout or clearing remote cookies.
State-changing requests are never replayed automatically.

The beta route table is intentionally empty: the root shell's session-state gate
is the current authenticated boundary. Any future protected route must consume
the same central session decision and add guard coverage.

## SSR/BFF security boundary

Express accepts at most 64 KiB of JSON by default. Oversized and malformed input
returns stable `413` or `400` JSON without echoing input or parser details. Every
selected UMG request has a five-second default deadline: expiry aborts the fetch
and returns `504`; other network failure returns `503`. Logs contain only the
service name and stable `timeout`/`unavailable` category. They do not contain the
upstream URL, exception text, request body, cookies or tokens.

API, static and SSR responses receive CSP, clickjacking, MIME-sniffing, referrer,
permissions and cross-origin opener protections. The CSP permits scripts and
connections only from the same origin; styles/fonts allow only same-origin data,
inline Angular SSR styles and the existing Google Fonts origins. `X-Powered-By`
is disabled. Production critical-CSS inlining is disabled because its generated
inline `onload` handler is intentionally incompatible with the script policy;
the hashed same-origin stylesheet remains render-blocking. Node request,
header and keep-alive timeouts are explicitly bounded. UMG continues to own its
downstream resilience, cookie flags and cache policy; the BFF preserves upstream
status, content type, cache policy and each `Set-Cookie` header.

Place-search terms and postcodes are sent only in URI-encoded requests to the
configured location gateway. Client transaction logs record the fixed action and
bounded result count only. Failure logs use a fixed category and never include
the query, postcode, upstream URL or raw exception.

## Local and Docker startup

```bash
npm run dev
docker build -t job-seeker-copilot-client .
docker run --rm -p 3000:3000 job-seeker-copilot-client
```

The SSR route itself is the current smoke/health target. Java dependency health
is not yet aggregated. Generated API documentation is contract-derived; do not
edit generated source manually.

## Branch workflow

Use `feature/* → develop`. Do not push feature work directly to `develop`.
`main` will be introduced later as a release branch.

## Troubleshooting

- Missing imports below `src/app/api`: run `npm run api:generate`. A checksum
  mismatch means the reviewed snapshot or lock was changed and generation stops.
- `503` from `/api/auth/*`: confirm SSR gateway URL and dependency health. `504`
  means the validated BFF downstream deadline elapsed.
- `503` from `/api/postcodes/*`: confirm location dependency health.
- Session service unavailable: use **Try again** after dependency health is
  restored. Do not inspect, copy, or manually edit cookie values.

## Licence

Copyright © 2026 Bernard McGeever. All rights reserved.

This repository contains proprietary software belonging to Bernard McGeever.
It may not be used, copied, modified or distributed without express written
permission. See [LICENSE](./LICENSE).
