# Job Seeker Copilot Client

Angular 21 browser application with an Express SSR/BFF layer. In the selected
beta path it proxies authentication/profile requests to user-management-gateway
and postcode requests to location-gateway.

> Beta status: not beta-ready. Reproducible builds and browser token custody are
> in place, while session lifecycle and end-to-end readiness work remains. See
> [the audit](docs/BETA_READINESS_AUDIT.md).

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

Never place provider or production credentials in Angular environment files;
browser bundles cannot keep a secret.

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

CLIENT-03 still owns startup session validation, one coordinated refresh,
authenticated route guards, and expiry/reload UX. Until it is complete, a page
reload returns to sign-in even if UMG still holds a valid cookie session.

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
- `503` from `/api/auth/*` or `/api/postcodes/*`: confirm SSR gateway URLs and
  dependency health.
- Session errors: retry sign-in. Do not inspect or copy cookie values. Startup
  validation, refresh, and expiry UX remain tracked by CLIENT-03.

## Licence

Copyright © 2026 Bernard McGeever. All rights reserved.

This repository contains proprietary software belonging to Bernard McGeever.
It may not be used, copied, modified or distributed without express written
permission. See [LICENSE](./LICENSE).
