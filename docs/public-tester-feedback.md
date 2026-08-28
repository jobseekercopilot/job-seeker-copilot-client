# Public-tester feedback browser boundary

The feedback action is disabled unless the SSR process receives an exact
`PUBLIC_FEEDBACK_API_URL`. The value must be a public HTTPS URL without
credentials, query or fragment. It is not a secret. An enabled endpoint also
requires a non-secret `PUBLIC_APP_RELEASE_ID` matching
`[A-Za-z0-9][A-Za-z0-9._-]{0,63}`. The server exposes both through
`GET /api/runtime/feedback-configuration` with `Cache-Control: no-store` and
adds only the URL origin to CSP `connect-src`. Invalid enabled configuration
stops the SSR process; a missing URL returns `{ "enabled": false }`.

The browser posts directly to that endpoint with `withCredentials: false`. The
intake must allow only the reviewed Job Seeker Copilot application origin,
`POST`, and `Content-Type`; it must not rely on CORS as an authentication or
abuse-control mechanism.

## Submitted data

The JSON body is at most 4,096 UTF-8 bytes and has exactly these fields:

- `appBuild`: the validated runtime-config release identifier asserted by the client;
  it is an investigation hint, not trusted provenance for an anonymous request;
- `category`: `BROKEN`, `CONFUSING`, `SUGGESTION`, or `OTHER`;
- `title`: 5–120 characters;
- `description`: 10–2,000 characters;
- `reproductionSteps`: 0–1,200 characters;
- `pagePath`: pathname only, at most 256 characters;
- `diagnosticsConsent`: explicit boolean choice;
- `diagnostics`: `null` without consent, otherwise browser family, major
  version and `mobile`, `tablet`, or `desktop` device class;
- `idempotencyKey`: a browser-generated UUID;
- `website`: an empty honeypot field; and
- `formStartedAt`: positive epoch milliseconds used by intake abuse controls.

The client does not capture query strings, fragments, referrers, profile or
account identifiers, cookies, authentication material, storage, full
user-agent strings, viewport dimensions, console or network logs, screenshots,
CVs, cover letters, or application content. User-entered text may still contain
sensitive data, so the form gives a prominent warning before submission.

The intake owns authoritative schema validation, content normalisation, spam
and rate controls, durable storage, server-side timestamp/build metadata, safe
logging, retention, and triage. A successful request returns HTTP 202 with
`FEEDBACK_ACCEPTED` and an opaque `FB-...` reference. The browser does not render
raw backend errors or response details.

## Bundle boundary

The dialog is lazy-loaded only after the user selects the feedback action. The
production initial-bundle hard ceiling is narrowly extended from 1,101 kB to
1,106 kB for this slice; the 5 kB delta is locked by the bundle-budget contract
test.
