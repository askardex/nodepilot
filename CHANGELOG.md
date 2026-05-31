# Changelog

All notable changes to NodePilot are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-05-31

First public release.

### Added
- Validator dashboard with live status, version and network for every node
- Compose deployment path: connect over SSH and install Canton end to end
- Kubernetes deployment path: provision the validator stack with Helm
- Network presets for DevNet, TestNet and MainNet with their SV scan endpoints
- Server monitoring (CPU, memory, disk, network) on the validator detail page
- Public access setup: domain configuration, DNS checks and Let's Encrypt certs
- Keycloak provisioning with admin and operator secret rotation
- Encryption at rest for SSH credentials, onboarding secrets and Keycloak passwords
- Single-operator auth with bootstrap-only registration (NextAuth v5)

### Changed
- Migrated the UI layer to the Materio Free MUI template (MIT) for open distribution

[1.1.0]: https://github.com/AskarDex/nodepilot/releases/tag/v1.1.0
