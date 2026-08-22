# Contributing

Work starts from `develop` and is submitted through a `feature/*` branch.
Do not push feature work directly to `develop`. The `main` release branch will
be introduced later when a release process is agreed.

```bash
git switch develop
git pull --ff-only
git switch -c feature/short-description
```

Run the repository's documented build, tests, linting, dependency audit, and
secret scan before opening a pull request. Keep generated binaries, local
configuration, credentials, recordings, runtime data, and build output out of
Git.

## Intellectual property

This is a private proprietary project. Contributions may only be made by
authorised contributors operating under a written agreement that addresses
ownership of intellectual property and confidentiality.

Do not submit third-party code unless its origin and licence have been
identified and approved.
