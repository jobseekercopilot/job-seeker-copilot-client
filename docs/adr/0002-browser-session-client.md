# ADR 0002: Adopt the UMG browser-session boundary

- Status: Accepted for controlled private beta
- Date: 2026-07-21
- Decision owner: Job Seeker Copilot
- Upstream decision: user-management-gateway ADR 0001

## Context

The previous client contract returned a bearer token to JavaScript, persisted it
with account identifiers and profile PII in browser storage, and forwarded
browser-selected authorization and user-ID headers. A successful script injection
could therefore exfiltrate a long-lived credential and personal data. The proxy
also accepted an email selector for profile operations, even though ownership must
come only from the authenticated subject.

UMG contract 2.0.0 replaces that boundary with separate HttpOnly access and
refresh cookies, a readable double-submit CSRF value, subject-bound profile
operations, server-side refresh/revocation, and token-free JSON responses.

## Decision

The Express SSR layer is a transparent, same-origin session proxy for the approved
`/api/auth/*` routes. It forwards only the browser `Cookie` and `X-CSRF-Token`
headers needed by UMG, relays every `Set-Cookie` header without combining it, and
preserves non-cacheable session responses. It never forwards browser
`Authorization` or `X-User-Id` and never adds an email or user-ID profile selector.

Angular generates its API from the exact UMG 2.0.0 snapshot at source revision
`589ccc77557addde7c26d2df4e79fda3d3a2e42f`. Before a state-changing session
request, it calls the public CSRF bootstrap. The response must name exactly
`X-CSRF-Token` and contain a non-empty random value; otherwise the operation fails.
The validated value lives only in an Angular provider and an interceptor applies
it only to mutating same-origin auth paths. It is never written to storage or logs.
Spring Security may replace the CSRF cookie while authenticating a protected
request, so successful authentication and profile transitions invalidate the
in-memory value. The next write performs a fresh bootstrap; failed writes are not
automatically replayed.

Registration and login consume token-free user/profile responses. Profile updates
use only the browser cookie. Logout calls UMG and clears in-memory name, email, and
profile state only after UMG confirms success; dependency failure remains visible
and is not described as remote revocation. The beta shell removes all obsolete
`jc_*` token, identity, login, free-text, and structured-profile values from both
browser storage mechanisms on startup.

The root beta shell starts in a checking state and renders no claimant PII until
subject-bound `GET /api/auth/profile` succeeds. A 401 on that safe read can start
one shared refresh request for all concurrent startup callers, followed by one
profile-read retry. No mutating request is replayed. Final 401 expiry clears the
token-free in-memory user; dependency/network failure clears rendered PII but
retains a distinct retryable unavailable outcome without claiming remote logout.
The selected route table is empty, so this root render-state gate is the current
authenticated boundary rather than an unused router guard.

UMG owns cookie names and flags. Its explicit local HTTP profile uses unprefixed
non-Secure cookies; production requires Secure host-only `__Host-` cookies. Access
and refresh cookies are HttpOnly and Angular does not inspect either form.

## Threat model and controls

- Script injection can still act as the signed-in user, but cannot read the
  access or refresh token or recover persisted profile PII from browser storage.
- Cross-site writes fail unless the attacker can supply the random double-submit
  CSRF value; exact-origin policy and SameSite cookies add defense in depth.
- Forged bearer or user-ID headers are discarded at the BFF and UMG also rejects
  them as identity.
- Cross-user profile selection is absent from both browser and proxy contracts.
- Cookies and CSRF values are never logged. Proxy network failures return a
  stable 503 and deadline expiry returns 504; logs contain only the service and
  failure category, without exception text, upstream URLs, bodies or credentials.
- The BFF bounds JSON bodies and Node/downstream timeouts, validates its selected
  runtime configuration before listening, and applies an Angular-compatible CSP
  plus baseline browser security headers to SSR, static and API responses.

## Consequences and residual work

Browser reload restores identity only from a successful server validation, never
from browser storage. The existing workspace Playwright/Cucumber framework must
still be extended under CLIENT-07/UMG-07 with separate beta/demo profiles,
isolated test data and cleanup, traces, CI, and complete negative-path Compose
evidence; this decision does not create a second E2E framework.

TLS termination, proxy-trust configuration, multi-instance refresh coordination,
legacy beta-disabled proxy removal, and production deployment remain outside
this client change and require separate platform evidence before beta readiness
can be claimed. Inline style execution remains allowed for Angular/Material SSR;
scripts and network connections remain same-origin only.
