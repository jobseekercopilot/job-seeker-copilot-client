# Payment BFF identity boundary

The `/api/v1/payment` prefix is exposed only through the same-origin Express
BFF. Its explicit route allowlist covers wallet, pricing, transaction history,
fixture purchase and checkout:

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
or a response that reflects its service token.

The BFF service token must contain at least 32 UTF-8 bytes; it is read only by
the SSR process and must be supplied through the runtime secret store. Missing
or weak token configuration fails closed without preventing unrelated product
capabilities from starting.

`demo-purchase` is the deterministic fixture route. Live Stripe checkout still
requires deliberate runtime credential/configuration selection; enabling this
BFF boundary does not itself make a paid provider call.
