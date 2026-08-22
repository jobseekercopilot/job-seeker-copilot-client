# Payment BFF identity boundary

Payment Gateway OpenAPI 2.2.0 is vendored from
`jobseekercopilot/payment-gateway` commit
`6db53bd9b98cbaac081fdd7c06cf95687f29e222` and pinned as a
`manual_boundary` in `contracts/manual-boundaries.lock.json`. Its SHA-256 and the
required v2 paths, headers, acknowledgement fields, document-generation schemas,
readiness codes, tax/seller snapshots, transaction semantics and order states
are verified before builds and tests. No Payment Gateway client is generated:
the small hand-written BFF and Angular boundary types remain reviewable alongside
the allowlist below.

The current `/api/v2/payments` prefix is exposed only through the same-origin
Express BFF. Its explicit route allowlist covers the server-owned catalogue,
wallet, transaction history, checkout readiness, idempotent checkout and
owner-scoped order status. The
legacy `/api/v1/payment` boundary is not registered:

1. It ignores browser `Authorization`, `X-User-Id`, and other identity
   selectors.
2. It sends only the HttpOnly session cookie to User Management Gateway
   `GET /api/auth/profile`.
3. It accepts ownership only from a successful response containing the stable
   `user.id`.
4. It sends `BFF_TO_PAYMENT_GATEWAY_TOKEN` and that owner as
   `X-Payment-Owner` to Payment Gateway.

Missing, invalid, expired, forged, or malformed sessions fail closed before
Payment Gateway is called. Payment mutations additionally require the
UMG-issued CSRF cookie to match the browser's in-memory `X-CSRF-Token` value.
The BFF accepts only bounded JSON responses and never relays downstream cookies
or a response that reflects its service token. Checkout accepts only a bounded
server-known plan identifier, `billingCountry: "GB"`,
`immediateSupplyRequested: true`, and
`cancellationRightLossAcknowledged: true`; it forwards the validated
`Idempotency-Key` and never accepts a browser-selected price, generation amount,
currency, success URL, terms version, acceptance time or owner. Payment Gateway
records the authoritative terms version and server acceptance time before
creating checkout.

Hosted checkout return URLs contain only a bounded `order_id`. Both success and
cancel routes remove that query from browser history, then reconcile it through
`GET /api/v2/payments/orders/{orderId}/status`. The page polls for no more than
30 seconds and says generations were added only for a durable `FULFILLED` response
with `generationsAdded: true`; route names and query values never grant entitlement.

The BFF service token must contain at least 32 UTF-8 bytes; it is read only by
the SSR process and must be supplied through the runtime secret store. Missing
or weak token configuration fails closed without preventing unrelated product
capabilities from starting.

The UI checks `/checkout-readiness` immediately before every attempt and opens
Stripe only after the response is `READY`. Enabling this BFF boundary does not
authorise a live release, configure Stripe or make a paid provider call.
