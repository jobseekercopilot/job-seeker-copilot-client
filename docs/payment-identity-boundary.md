# Payment BFF identity boundary

The `/api/v1/payment` prefix remains beta-disabled. Express registers the stable
`404 FEATURE_NOT_AVAILABLE` middleware before every retained payment handler,
so no profile or payment dependency call occurs in the current beta.

The retained proxy is prepared for a future, separately approved enablement:

1. It ignores browser `Authorization`, `X-User-Id`, and other identity
   selectors.
2. It sends only the HttpOnly session cookie to User Management Gateway
   `GET /api/auth/profile`.
3. It accepts ownership only from a successful response containing the stable
   `user.id`.
4. It sends `BFF_TO_PAYMENT_GATEWAY_TOKEN` and that owner as
   `X-Payment-Owner` to Payment Gateway.

Missing, invalid, expired, forged, or malformed sessions fail closed before
Payment Gateway is called. The BFF service token must contain at least 32 UTF-8
bytes; it is read only by the SSR process and must be supplied through the
runtime secret store. Missing or weak token configuration fails closed if the
retained handler is ever invoked, but does not prevent the beta-disabled client
from starting.

Enabling payment also requires the remaining Payment epic controls, operational
secret wiring, and explicit product approval. This boundary alone is not
approval for live Stripe or payment UI.
