# Job Seeker Copilot Client

Angular 21 browser application with an Express SSR/BFF layer. In the selected
beta path it proxies authentication/profile requests to user-management-gateway
and postcode requests to location-gateway.

> Beta status: not beta-ready. Generated API sources are not committed and the
> clean-clone generation/publication workflow is P0 work. See
> [the audit](docs/BETA_READINESS_AUDIT.md).

## Prerequisites

- Node.js 24 (CI baseline)
- npm and the committed `package-lock.json`
- compatible OpenAPI contracts/client generation for every imported API
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

The commands currently fail from a clean clone until CLIENT-01 supplies the
generated-client inputs. This failure is intentional and visible in CI.

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

- Missing imports below `src/app/api` or `src/generated`: CLIENT-01 is open;
  regenerate only from reviewed contracts and do not commit output.
- `503` from `/api/auth/*` or `/api/postcodes/*`: confirm SSR gateway URLs and
  dependency health.
- Session errors: clear local beta data and sign in again; token lifecycle
  hardening remains open.

## Licence

Copyright © 2026 Bernard McGeever. All rights reserved.

This repository contains proprietary software belonging to Bernard McGeever.
It may not be used, copied, modified or distributed without express written
permission. See [LICENSE](./LICENSE).
