# ADR 0001: Reproducible API clients for the User Management beta

- Status: Accepted
- Date: 2026-07-21
- Decision owner: Job Seeker Copilot

## Context

The client imported generated TypeScript from untracked directories and rebuilt it
from sibling repositories. A clean clone therefore could not lint, test, or build.
The User Management beta needs only the user-management and location contracts.
There is no authoritative private owner repository from which to publish the
currently imported job-finder, document-generation, or reporting contracts.

## Decision

Version the owning backends' tested OpenAPI documents under `contracts/`, recording
their repository, source commit, semantic version, SHA-256 checksum, required paths,
and output path in `contracts/contracts.lock.json`. Generate ignored Angular sources
with OpenAPI Generator 7.23.0 before lint, test, and build. Missing, changed, or
incomplete inputs fail before generation.

The User Management beta build exposes only user-management and location. Job
finder, document generation, and reporting remain in the repository but are disabled
in `beta-features.ts`; their SSR paths fail closed. Re-enabling one requires a private
owning repository, a reviewed versioned contract, and a separate issue. This decision
does not audit or migrate those capabilities.

## Consequences

Generated code remains excluded from Git and can always be recreated from reviewed
inputs. Contract updates are deliberate lock-file changes and must include backend
contract-test evidence. Browser session security is intentionally handled by
CLIENT-02 and is not resolved by this build decision.
