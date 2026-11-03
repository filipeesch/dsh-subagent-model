# Design

## Context

The package already declares a DSH bundle patch, a host compatibility range, and a runtime entry point without runtime dependencies. The current README and isolated smoke test cover only `link:` installation. DSH's existing Plugins interface accepts a GitHub repository URL and manages installation and optional activation for the connected host's profile. See the proposal for motivation and the delta spec for behavioral requirements.

## Goals / Non-Goals

**Goals:**
- Verify the distribution and user-facing installation flow without adding plugin runtime responsibilities.
- Keep offline tests deterministic and keep real-network verification isolated and attributable to a published revision.
- Make trust, host location, activation, and version-selection boundaries explicit.

**Non-Goals:**
- Change the DSH plugin manager, add a custom installer, or modify native UI behavior.
- Automatically enable the plugin, impose a fixed version, publish code on the user's behalf, or install on a remote browser machine.
- Modify route selection or delegation semantics.

## Decisions

1. **Delegate installation and activation to DSH.** Document Plugins > Add plugin > Install a third-party plugin, the repository URL, and the existing Enable now action. Preserve the GitHub spec as supplied and let the host/package manager resolve an omitted reference. A plugin-provided installer cannot bootstrap itself before installation and duplicates host responsibilities.
2. **Verify distribution independently of plugin logic.** Add small focused tests for the manifest, bundle patch and required distributable files; adjust metadata only if a concrete issue is found. Keep verification helpers separate from `index.js` and existing domain modules, inject process/filesystem seams where useful, and avoid production dependencies. Local linking remains documented for development.
3. **Separate offline and network lanes.** Keep `pnpm test` and the existing isolated, credential-free `pnpm smoke` unchanged in their offline guarantees. Add a separately invoked real GitHub installation check that accepts the URL/reference, creates its own disposable DSH home/profile, installs through the host's supported installer, and verifies bundle loading and both registered tools with a local model stub. Report tested URL and resolved commit; fail or explicitly mark unverified when resolution, network, compatibility or publication prevents proof. Reuse focused smoke utilities only if extraction reduces duplication without coupling lanes.
4. **Validate the user-visible flow separately.** Perform a manual GUI acceptance check using a disposable host/profile and the exact documented URL, including the optional Enable now action. An isolated CLI/service-level test alone does not prove the GUI workflow. Record the actual published revision and observed results; do not use the live profile, session, or board.
5. **Treat GitHub content as executable code.** Explain that installation runs on the connected host, may execute third-party code or approved install scripts, and uses host-managed approvals. Never assume version pinning, script approval, sandboxing, or successful activation. Do not automatically approve scripts in validation.

## Risks / Trade-offs

- [Unpublished changes] → A GitHub check validates only the published revision; record its commit and do not claim it tested unpublished local changes. Repeat after publication when necessary.
- [Network or runtime unavailable] → Report the external lane as failed or unverified; offline tests cannot replace real integration evidence.
- [Mutable unreferenced URL] → Explain that DSH resolves the default revision and a user-supplied supported reference can be used when reproducibility is desired.
- [Host and browser differ] → Explicitly describe remote-host installation and profile scope in the README.
- [External code execution] → Use only a trusted repository and disposable home, avoid credentials or automatic build-script approval, and document the trust boundary.
- [DSH GUI behavior varies by version] → Validate against a compatible installed host; report discrepancies rather than inventing supported UI steps.

## Migration Plan

No user data migration is required. Publish the verified package changes before claiming the real URL installs them; retain local-link instructions for developers. Roll back documentation or distribution changes through normal version control if verification reveals a regression; no host configuration migration is introduced.
