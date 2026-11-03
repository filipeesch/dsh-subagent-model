# Tasks

## 1. Distribution and documentation

- [x] 1.1 Add focused automated checks for the DSH bundle manifest, patch, compatibility range, runtime entry point, and required distributed files; run the tests and fix only evidenced distribution defects.
- [x] 1.2 Update the README with the exact GitHub URL and existing DSH third-party installer and Enable now flow; review it against a compatible DSH UI and retain local linking under development.
- [x] 1.3 Document supplied-reference versus default-revision behavior, host/profile location, compatibility, and third-party code trust; verify each is present and does not promise unsupported automatic activation.

## 2. Isolated installation verification

- [x] 2.1 Create a separately invoked network-dependent verification path accepting the repository URL/reference, using a disposable DSH home/profile and no automatic script approvals; test cleanup and failure reporting with isolated fakes.
- [x] 2.2 Verify the GitHub-installed bundle loads and both tools register using a local model stub; report the tested URL and resolved commit, and test failure or explicit non-verification when the network or runtime is unavailable.
- [x] 2.3 Document how to run the network check, its prerequisites and limitations, and confirm the existing offline smoke does not access GitHub or live user data.

## 3. End-to-end acceptance

- [x] 3.1 Run `pnpm test` and `pnpm smoke`; confirm both pass with the smoke confined to a disposable home and local model stub.
- [ ] 3.2 Run the network-dependent check against the published repository and record URL, resolved commit, host version, and results; if the implementation revision is unpublished, do not claim it was tested and repeat after publication.
  - Initial check passed for `https://github.com/filipeesch/dsh-subagent-model` at `f782e2e57eeae8e82a19a5968c0176fde2e7c33f` with DSH `0.2.1-rc.5`; both tools registered and the catalog executed. Local implementation changes were not published or tested by this check.
- [ ] 3.3 In a disposable DSH host/profile, manually follow the documented GUI flow with the published URL, choose Enable now, verify both tools are available, and record results without modifying the live profile, sessions, or board.
