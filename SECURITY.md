# Security policy

This repository is private. Report suspected vulnerabilities privately to the
repository owner. Do not open a public issue or include credentials, tokens,
personal data, exploit details, or production logs in an issue.

Do not commit secrets. Use runtime environment variables or the approved
secret-management mechanism. If a credential may have been exposed, stop its
use, report the type and affected location without reproducing its value, and
arrange rotation with the owner.

The current code is a beta-readiness baseline, not a security certification.
Known risks and beta blockers are tracked in `docs/BETA_READINESS_AUDIT.md`.

CI scans the complete Git history with the pinned Gitleaks image through
`scripts/verify-secret-history.sh`. The scan fails closed when Git discovery
fails, the repository has no commits, Gitleaks rejects the history, or the
scanner does not report a non-zero commit count. Only the read-only checkout is
marked as a safe Git directory inside the disposable scanner container.
`scripts/test-secret-history.sh` verifies those controls with disposable
repositories, including a synthetic credential that is never added to this
repository.
