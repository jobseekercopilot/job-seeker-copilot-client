# Beta-readiness audit: client

Audit date: 18 July 2026

Status: **Not beta-ready.** The current UI demonstrates registration, login,
profile editing and postcode lookup, but its clean build, session security,
location search, negative-path coverage and browser E2E path are incomplete.

## Verified role

The Angular application is served by an Express SSR/BFF process. Browser calls
to `/api/auth/*` and `/api/postcodes/*` are proxied by `src/server.ts` to the
user-management and location gateways. The browser does not call those Java
services directly. Generated TypeScript clients are compile-time dependencies.

## Current baseline

- `npm test -- --watch=false`: 28 tests in six files passed.
- `npm run lint`: failed with 76 errors and 18 warnings, predominantly in
  generated sources plus one handwritten array-style error.
- `npm run build`: current tree passed in approved host networking with bundle
  budget warnings; a fresh clone still lacks generated client trees.
- `npm audit --json`: 4 High, 3 Low, 0 Critical vulnerable dependency chains;
  fixes were reported as available.
- Gitleaks: no confirmed real credential in the selected client tree. The
  local `yay/` cache and generated client directories are excluded from this
  repository.

## Findings

| ID | Finding | Evidence | Risk and severity | Recommended solution and acceptance criteria | Dependencies | Beta blocker | Effort |
|---|---|---|---|---|---|---|---|
| [CLIENT-01](https://github.com/jobseekercopilot/job-seeker-copilot-client/issues/1) | Make generated API clients reproducible | `package.json` exports contracts from sibling repositories and generates `src/app/api`; handwritten code also imports `src/generated`, which has no clean-clone generation step. | **Critical / P0:** `npm ci` cannot produce a build from this repository alone. | Store/version the required OpenAPI inputs or consume versioned packages; generate in a deterministic prebuild; exclude generated output; prove `npm ci && npm run lint && npm test -- --watch=false && npm run build` in a fresh clone. | Contract publication for selected and currently imported out-of-scope APIs. | Yes | XL |
| [CLIENT-02](https://github.com/jobseekercopilot/job-seeker-copilot-client/issues/2) | Remove bearer tokens and profile PII from `localStorage` | `src/app/app.ts:129-149,221-231` persists token, user ID, email and full profile. | **High / P1 security/privacy:** any successful script injection can exfiltrate a 24-hour bearer token and profile data. | Adopt an agreed BFF/session-cookie or short-lived in-memory token design; use Secure, HttpOnly, SameSite cookies if cookies are selected; add XSS/session tests; document the threat model. | AUTH-03 and SSR security design. | Yes | L |
| [CLIENT-03](https://github.com/jobseekercopilot/job-seeker-copilot-client/issues/3) | Enforce authenticated routing and expiry handling | `src/app/app.routes.ts` maps every route to the dashboard without guards; `app.ts` trusts `jc_logged_in` before token validation; logout is local only. | **High / P1:** stale sessions expose authenticated UI and revocation is impossible. | Add a central session service and route guards; validate/refresh on startup; handle 401 once; clear all session state; test refresh, expiry, browser reload and logout. | AUTH-03. | Yes | L |
| [CLIENT-04](https://github.com/jobseekercopilot/job-seeker-copilot-client/issues/4) | Harden the Express SSR/BFF boundary | `src/server.ts` enables unbounded `express.json()`, has no Helmet/CSP/security-header policy, uses permissive local defaults and repeats proxy logic. | **High / P1 security/reliability:** request exhaustion, inconsistent forwarding and XSS impact are insufficiently bounded. | Set body/time limits, abort downstream calls, validate runtime configuration, add CSP and baseline headers, redact operational errors and test SSR/hydration and proxy failures. | Gateway timeout contracts. | Yes | L |
| [CLIENT-05](https://github.com/jobseekercopilot/job-seeker-copilot-client/issues/5) | Restore or remove general location search | `LocationService.search()` calls generated `searchLocations`; `LocationGateway.handleSearch()` proxies `/api/locations`, but `location-gateway` exposes only `/api/postcodes/{postcode}`. | **High / P1 functional:** non-postcode location entry silently returns no suggestions. | Agree API ownership; implement a tested search endpoint or remove the UI path; cover empty, partial, invalid and provider-outage cases. | LOC-02. | Yes | M |
| [CLIENT-06](https://github.com/jobseekercopilot/job-seeker-copilot-client/issues/6) | Align registration validation and password handling | Client requires six characters and trims the password; gateways accept four and use only `contains("@")`. | **High / P1 security/UX:** weak and inconsistent policy; trimming changes a user's chosen secret. | Share documented constraints through the contract; do not mutate passwords; use accessible inline validation and equivalent server checks; test Unicode/whitespace/boundaries. | AUTH-02, UMG-04. | Yes | M |
| [CLIENT-07](https://github.com/jobseekercopilot/job-seeker-copilot-client/issues/7) | Add user-management component and browser E2E coverage | No specs cover `landing-auth`, claimant profile, auth persistence, route guards or the complete six-service path. | **High / P1 testing:** the core beta journey and unauthorised cases can regress undetected. | Add component tests and automated browser tests for registration, duplicate registration, login failure/success, profile update, postcode success/failure, expiry and cross-user denial. | Stable test environment and contracts. | Yes | L |
| [CLIENT-08](https://github.com/jobseekercopilot/job-seeker-copilot-client/issues/8) | Complete accessibility and resilient UX review | Multi-step forms use template-driven state; no automated axe/keyboard/screen-reader evidence exists and provider errors are often hidden by empty suggestions. | **Medium / P1 frontend:** beta users may be unable to understand or complete forms. | Meet WCAG 2.2 AA for the path; add labels, focus/error summaries, keyboard tests, loading/empty/offline states and duplicate-submit protection. | CLIENT-05. | Yes | M |
| [CLIENT-09](https://github.com/jobseekercopilot/job-seeker-copilot-client/issues/9) | Harden and verify the runtime container | `Dockerfile` uses mutable image tags, runs as root, copies all build dependencies and has no health check. | **Medium / P1 devops:** oversized mutable image and unnecessary runtime privilege. | Pin supported images by digest, install production-only runtime deps, run non-root, add health check and scan the image; prove graceful shutdown. | CLIENT-01. | Yes | M |
| [CLIENT-10](https://github.com/jobseekercopilot/job-seeker-copilot-client/issues/10) | Remediate locked High dependency advisories | Live `npm audit` reports High chains through direct `@angular/build` and transitive `piscina`, `undici` and `vite` (4 High total). | **High / P1 dependency:** known build/runtime tooling weaknesses violate the beta Definition of Done until fixed or explicitly risk-assessed. | Update the Angular/tooling lock safely, review reachability and advisory details, rerun tests/build/audit, and record any accepted residual risk; acceptance is 0 unaccepted Critical/High. | CLIENT-01. | Yes | M |
| [CLIENT-11](https://github.com/jobseekercopilot/job-seeker-copilot-client/issues/11) | Bring production bundles within agreed budgets | Current production build warns that the initial bundle is 656.07 kB against a 500 kB warning budget and six component styles exceed their warning budgets. | **Medium / P2 frontend:** slower startup and growing CSS can degrade beta UX, especially on constrained devices. | Profile the selected path, remove/defer unused code and styles, agree realistic budgets, and make the build warning-free without hiding regressions. | CLIENT-01. | No | M |

## Scope not audited

Job finding, documents, reporting, payment, AI-provider behaviour, landing-page
deployment and AWS configuration were inspected only where they affected this
client's build. They were not functionally or security audited.
