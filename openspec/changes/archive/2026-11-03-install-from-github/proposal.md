# Proposal

## Why

Users currently have instructions only for linking a local checkout, even though DSH's existing plugin manager accepts GitHub repository URLs. The project needs a verified, documented installation path that does not require users to clone the repository themselves.

## What Changes

- Support and document installation of this plugin through the existing DSH Plugins interface using the GitHub repository URL and the reference supplied by the user.
- Document the existing optional Enable now step, host/profile scope, compatibility requirements, and the trust implications of installing third-party code.
- Add isolated automated coverage for distribution and installation-related invariants, and validate the actual published GitHub URL against an isolated DSH profile separately from the existing offline smoke test.
- Retain local linking as a development workflow and preserve existing delegation behavior and plugin lifecycle.

## Capabilities

### New Capabilities

- `github-plugin-installation`: Distribution, documented installation, activation, and verification of this plugin through DSH's existing GitHub installation flow.

### Modified Capabilities

None.

## Impact

The README and installation verification tooling/tests are affected; package metadata or bundle contents may need correction if verification exposes a defect. The DSH plugin manager and GitHub are external dependencies for the real installation check. No new DSH UI, plugin runtime service, or runtime dependency is intended. The real check requires network access, a published GitHub revision, and a disposable DSH home; the existing offline verification lane remains unchanged in purpose.
