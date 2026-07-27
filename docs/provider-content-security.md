# Provider content and external-link security

Job titles, company names, descriptions, publisher labels and provider status
text are untrusted external content. Angular templates render them only through
text interpolation; provider markup is never bound through `innerHTML`.

External job links pass the same policy at both browser and BFF boundaries:

- the value must be an absolute `http` or `https` URL;
- credentials, leading/trailing whitespace, control characters, relative URLs
  and URLs longer than 2,048 characters are rejected;
- `javascript`, `data`, `file` and other schemes never render as links;
- rejected links become `null` at the BFF and an inert “External job link
  unavailable” state in the component;
- external anchors use a new browsing context with `noopener noreferrer` and
  an accessible name that states a new tab opens;
- identical listing URLs are rendered once, while distinct safe sources remain
  independently accessible.

The BFF applies the policy to `url`, `sourceUrl`, `listingUrl` and `applyUrl`
fields in Job Finder JSON responses. Malformed JSON fails closed with the stable
`502 INVALID_DOWNSTREAM_RESPONSE` response. This is a defence-in-depth boundary;
producer contracts and provider gateway validation remain authoritative.

Client and BFF logs must not contain job objects, search/profile text, provider
response bodies, URLs or raw exceptions. Job Search diagnostics use fixed event
names plus bounded counts or stable categories only.

Regression fixtures cover active-content strings, unsafe URL schemes,
credential-bearing and malformed URLs, duplicated sources, raw-log capture and
malformed downstream JSON. Run them with the normal local client test suite.
