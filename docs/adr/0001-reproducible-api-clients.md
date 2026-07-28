# ADR 0001: Reproducible API clients

- Status: Superseded in part by ADRs 0003–0005
- Date: 2026-07-21
- Updated: 2026-07-28
- Decision owner: Job Seeker Copilot

## Context

The client originally imported generated TypeScript from untracked directories
and rebuilt it from sibling repositories. A clean clone therefore could not
lint, test or build. The first remediation selected only User Management and
Location contracts while other service repositories were being established.

That temporary reduced-product assumption no longer applies. Job Finder and
Document Generation now publish authoritative contracts, the normal `App` is
the only frontend, and Infrastructure locks the complete repository catalogue.

## Decision

Version each owning backend's tested OpenAPI document under `contracts/`.
Record its repository, source commit, semantic version, checksum, required
paths and output path in `contracts/contracts.lock.json`.

Generate ignored Angular sources with the pinned OpenAPI Generator before
linting, tests and builds. Generation must be deterministic, checksum-verified
and confined to the canonical `src/app/api` root. Missing, changed or
incomplete inputs fail before generation.

Only capabilities with a reviewed contract and secure session-derived BFF
boundary may be enabled. Reporting and Payments remain fail-closed until those
conditions are met; this is a capability-safety decision, not a separate
application architecture.

## Consequences

Generated code remains excluded from Git and can be recreated from reviewed
inputs. Contract updates require lock-file changes and producer contract-test
evidence. Browser identity is derived from HttpOnly sessions as described by
ADR 0002. Job Finder and Document Generation consumer decisions are refined by
ADRs 0003–0005.
