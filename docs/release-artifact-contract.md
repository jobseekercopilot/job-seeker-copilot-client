# Client release artifact contract

This repository produces the Job Seeker Copilot browser application and its
same-origin Node SSR/BFF as one OCI image. The central infrastructure repository
owns ECR, ECS, DNS, certificates, secrets, environment approvals and deployment.
This repository must not create or update AWS resources.

## Branch and provenance boundary

- `feature/*`, `develop` and `main` run repository verification only. They never
  publish an image, assume an AWS role or deploy. Pull requests targeting
  `develop` or `main` run the same verification.
- A reviewed merge to protected `main` is the only source that central release
  orchestration may consume.
- The release image is built from the exact `main` commit with the committed
  `Dockerfile`, `package-lock.json` and contract snapshots. Infrastructure tags
  it with the Git commit for traceability, but deploys an immutable ECR digest,
  never a mutable tag.
- `npm run lint`, `npm test -- --watch=false`, `npm run build`, container policy
  verification and the configured vulnerability gate must pass for that commit.

## Runtime image interface

| Contract | Required value |
|---|---|
| Process | `node dist/job-seeker-copilot-client/server/server.mjs` as PID 1 |
| User | UID/GID `1000:1000` |
| Port | `3000` by default; overridable with validated `PORT` |
| Health | HTTP `GET /` on the task loopback must return a status below 500 |
| Filesystem | Read-only root filesystem with a small writable `/tmp` tmpfs |
| Shutdown | `SIGTERM`; stop accepting work, drain for at most ten seconds, exit |
| Contents | Bundled `dist` only; no npm, package manager or app `node_modules` |

Do not deploy the Angular `browser` directory by itself. Authentication,
owner-scoped payments and the other browser APIs rely on the same-origin BFF in
this image.

## Runtime configuration boundary

Infrastructure supplies configuration only at task startup. It must not bake
credentials or environment-specific endpoints into the image. In addition to
the validated variables in the main README, production supplies:

- HTTPS/internal service origins for User Management, Job Finder, Location,
  Document Generation, Document Store and Payment Gateway;
- `BFF_SESSION_COOKIE_PROFILE=production`, an explicit `NG_ALLOWED_HOSTS`, and
  the server-only `BFF_TO_PAYMENT_GATEWAY_TOKEN` secret;
- explicit provider modes for job search and document generation;
- optional `PUBLIC_FEEDBACK_API_URL` only after the public HTTPS intake and its
  exact application-origin CORS policy pass review; omission keeps feedback off;
- a non-secret `PUBLIC_APP_RELEASE_ID` matching the reviewed image release when
  feedback is enabled, so reports carry server-supplied build provenance;
- `COMMUTE_ROUTING_MODE=DISTANCE_ONLY` for initial beta unless Google Routes has
  separately passed its release gate;
- reviewed legal identity, seller form (`SOLE_TRADER` or `LIMITED_COMPANY`),
  explicit tax status, contact, ICO status, version, effective date and
  retention values. Missing or partial legal configuration remains visibly
  draft and keeps account creation and purchasing disabled;
- one `LEGAL_VERSION` shared with User Management Gateway registration
  requirements and the Payment Service's server-owned consumer terms version.
  The server-supplied Terms and Privacy URLs must resolve to this image's
  public `/terms` and `/privacy` routes. Registration and checkout both fail
  closed on a version mismatch rather than accepting stale terms.

Secrets come from the infrastructure-owned secret store and must never appear
in task definitions, browser configuration, build arguments, logs or artifacts.
Payment Gateway remains authoritative for catalogue, tax treatment, promotion,
checkout readiness and order fulfilment. Deploying this image alone must not
enable live payments or providers.

## Evidence returned to central release orchestration

For a candidate `main` commit, central orchestration records the source SHA,
image digest, build/test result, vulnerability result and production environment
approval. Rollback selects a previously approved digest; it does not rebuild
old source or retag a different image.
