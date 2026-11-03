# GitHub Plugin Installation

## Purpose

Enable users to install and activate this plugin from its GitHub repository using the existing DSH plugin manager.

## ADDED Requirements

### Requirement: GitHub repository is installable as a DSH bundle
The published plugin repository SHALL be installable as a DSH bundle from its GitHub repository URL using a compatible DSH host's existing third-party plugin installation flow, without requiring the user to clone it locally.

#### Scenario: Install using the repository URL
- **WHEN** a user enters the published repository URL in the DSH third-party plugin installer and installation succeeds
- **THEN** the plugin is installed into the connected host's profile
- **AND** no user-managed local checkout is required

#### Scenario: Bundle is incompatible with the host
- **WHEN** installation is attempted on a DSH host outside the declared compatible range
- **THEN** the bundle is not loaded and the user receives the host's installation error

### Requirement: Installation respects the supplied reference
The plugin's installation guidance SHALL preserve any supported reference supplied in the GitHub installation specification and SHALL NOT impose an additional fixed version.

#### Scenario: Reference supplied
- **WHEN** a user supplies a GitHub installation specification with a supported reference
- **THEN** the DSH installer receives that specification without a plugin-imposed replacement reference

#### Scenario: No reference supplied
- **WHEN** a user supplies the repository URL without a reference
- **THEN** the DSH installer and its package manager determine the default revision

### Requirement: Activation uses existing DSH controls
The installation guidance SHALL use the DSH plugin manager's existing activation controls rather than requiring automatic activation or a new plugin-specific interface.

#### Scenario: Enable after installation
- **WHEN** the user chooses Enable now after a successful installation
- **THEN** the host enables the plugin through its existing flow
- **AND** the plugin's two tools are available after the host loads it

#### Scenario: Install without enabling
- **WHEN** the user closes the installation flow without enabling the plugin
- **THEN** installation alone is not represented as proof that the plugin is active

### Requirement: Installation guidance explains host scope and trust
The documentation SHALL identify the repository URL, installation and activation steps, host/profile scope, compatibility requirements, and trust implications of executing third-party plugin code.

#### Scenario: Remote host
- **WHEN** a user accesses a remote DSH host from a browser
- **THEN** the guidance states that installation affects the connected host and its profile, not necessarily the browser's machine

#### Scenario: Development checkout
- **WHEN** a developer needs to test a local checkout
- **THEN** the existing local-link development workflow remains documented

### Requirement: Installation verification is isolated
The project SHALL provide isolated automated installation-related coverage and SHALL verify the real published GitHub installation separately from the existing offline smoke lane.

#### Scenario: Offline verification
- **WHEN** the existing smoke lane runs
- **THEN** it remains offline and uses a disposable DSH home and local model stub

#### Scenario: Real published installation verification
- **WHEN** the network-dependent check runs against a published revision
- **THEN** it uses a disposable DSH home and profile rather than live user data
- **AND** it verifies that the GitHub-installed bundle loads and exposes both plugin tools
- **AND** it reports the tested URL and resolved revision so the result is attributable to published content

#### Scenario: External installation cannot be verified
- **WHEN** the GitHub repository, network, or compatible DSH runtime is unavailable
- **THEN** the real installation check reports a failure or explicit non-verification rather than claiming success from offline tests
