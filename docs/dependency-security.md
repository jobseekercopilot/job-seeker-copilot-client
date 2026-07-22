# Dependency security baseline

## Policy

The selected beta build blocks unaccepted Critical and High npm advisories in CI.
Production and complete dependency trees are reviewed separately because build-only
tooling is not shipped in the SSR image. Do not use `--force`, legacy peer resolution,
or audit exclusions to make the gate pass.

## CLIENT-10 remediation evidence

| Scope | Before | After |
|---|---:|---:|
| Complete tree | 1 Critical, 11 High, 6 Moderate, 4 Low | 0 Critical, 0 High, 3 Moderate |
| Production tree | Not separately clean | 0 findings |

Remediation retained Angular 21 and updated it to supported patch releases. The
OpenAPI npm wrapper was removed because both its current and downgrade candidates
had High advisory chains. Generation now uses the official OpenAPI Generator 7.23.0
Maven artifact and verifies its locked SHA-256 before execution. The unused direct
`@google/genai` production dependency was also removed.

The three remaining Moderate findings are one development-only chain from
`@angular/cli` through `@modelcontextprotocol/sdk` to `@hono/node-server`. The affected
Hono Windows static-file adapter is not imported by application source, is absent
from the production dependency tree, and is not used by the Linux CI build. It is a
monitored tooling residual rather than an accepted Critical/High risk. Upgrade the
Angular 21 CLI when its supported dependency graph contains `@hono/node-server`
2.0.5 or newer; do not downgrade the CLI or force an incompatible transitive version.

Verification commands:

```bash
npm ci
npm run lint
npm test -- --watch=false
npm run build
npm audit --omit=dev --audit-level=moderate
npm audit --audit-level=high
./scripts/verify-container.sh job-seeker-copilot-client:verify
```

## Runtime image policy

The Node 24 Alpine build and runtime inputs are pinned to a reviewed manifest
digest. The build stage alone contains npm, Angular tooling and the checksum-
verified OpenAPI generator prerequisites. Angular's server output is bundled,
so the final image copies only `dist`, invokes Node directly and removes npm,
Corepack and Yarn. CI runs the image read-only as a non-root user, proves health
and bounded graceful shutdown, then blocks fixed Critical/High OS or library
findings with Trivy 0.72.0.
