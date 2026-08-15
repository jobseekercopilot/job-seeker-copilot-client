# Payment BFF identity boundary

Payment Gateway OpenAPI 2.1.1 is vendored from
`jobseekercopilot/payment-gateway` commit
`c49f9dc7441d146e58b428793a9c1a833c24aec5` and pinned as a
`manual_boundary` in `contracts/manual-boundaries.lock.json`. Its SHA-256 and the
required v2 paths, headers, acknowledgement fields, document-credit schemas,
readiness codes, tax/seller snapshots, transaction semantics and order states
are verified before builds and tests. No Payment Gateway client is generated:
the small hand-written BFF and Angular boundary types remain reviewable alongside
the allowlist below.

The current `/api/v2/payments` prefix is exposed only through the same-origin
Express BFF. Its explicit route allowlist covers the server-owned catalogue,
wallet, transaction history, checkout readiness, idempotent checkout and
owner-scoped order status. The
legacy `/api/v1/payment` boundary is read-only; its browser checkout and demo
purchase mutations are deliberately not registered:

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
`Idempotency-Key` and never accepts a browser-selected price, credit amount,
currency, success URL, terms version, acceptance time or owner. Payment Gateway
records the authoritative terms version and server acceptance time before
creating checkout.

Hosted checkout return URLs contain only a bounded `order_id`. Both success and
cancel routes remove that query from browser history, then reconcile it through
`GET /api/v2/payments/orders/{orderId}/status`. The page polls for no more than
30 seconds and says credits were added only for a durable `FULFILLED` response
with `creditsAdded: true`; route names and query values never grant entitlement.

The BFF service token must contain at least 32 UTF-8 bytes; it is read only by
the SSR process and must be supplied through the runtime secret store. Missing
or weak token configuration fails closed without preventing unrelated product
capabilities from starting.

The UI checks `/checkout-readiness` immediately before every attempt and opens
Stripe only after the response is `READY`. Enabling this BFF boundary does not
authorise a live release, configure Stripe or make a paid provider call.
