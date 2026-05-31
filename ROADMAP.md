# Roadmap

This is a working plan, not a promise. Items move as priorities shift and as the
Canton/Splice releases land. Current release: **v1.1.0**.

A note on scope: NodePilot manages the validator application. Network-level
onboarding — getting your egress IP onto the SV allowlist and obtaining an
onboarding secret from your SV sponsor — happens outside the tool and is covered
in the
[Canton validator onboarding docs](https://docs.canton.network/global-synchronizer/deployment/onboarding-process).
NodePilot takes over once you have a secret and a reachable host.

## Working today (v1.1.0)

- Docker Compose deployment over SSH, install runs through to completion
- Domain / DNS configuration
- Let's Encrypt TLS provisioning
- Keycloak brought up as part of the stack

## Known issues

These are real gaps in the current release, listed so nobody is surprised.

- **User onboarding keys off the Keycloak subject ID.** New users are identified
  by the raw Keycloak ID instead of a chosen username, so the mapping from a
  human account to a Canton party isn't where it should be.
- **Every onboarded account lands as a validator.** There's no distinction yet
  between the validator operator and a regular wallet user / party — everyone
  ends up with validator status.
- **Keycloak setup is fragile.** It comes up, but the realm/client wiring needs
  hardening before it's dependable.

## v1.2.0 — Fix user and party onboarding

The priority. Make the Keycloak-to-Canton mapping correct and predictable.

- [ ] Map a chosen username (not the Keycloak subject) to the Canton user
- [ ] Resolve and store the party ID for each onboarded account
- [ ] Distinguish roles: validator operator vs. wallet user
- [ ] Harden Keycloak realm/client provisioning and make it idempotent
- [ ] Surface the party ID and role on the user list in the UI

## v1.3.0 — Backup and restore

Currently unfinished.

- [ ] Back up validator identity (keys / participant identity)
- [ ] Back up the validator database / config snapshot
- [ ] Restore a node from a backup onto a fresh host
- [ ] Scheduled backups with a retention policy

## v1.4.0 — Update and upgrade

Currently unfinished.

- [ ] Detect the installed Splice version against the network's expected version
- [ ] Guided upgrade between Splice versions with a pre-flight check
- [ ] Roll back to the previous version if an upgrade fails
- [ ] Show migration ID changes and warn before a hard domain migration

## v1.5.0 — Kubernetes

The Helm path exists but does not yet deploy a working validator end to end.

- [ ] Get the Helm-based install to parity with the Compose path
- [ ] Validate ingress, TLS and Keycloak on the cluster path
- [ ] Document the kubeconfig and chart-value requirements

## v1.6.0 — Operations and monitoring

- [ ] Start / stop / restart a validator from the dashboard
- [ ] Tail install and runtime logs in the browser
- [ ] Scheduled health checks with status history per node

## Under consideration

Not scheduled, may not happen.

- [ ] Roles beyond operator (read-only viewer) and an audit log
- [ ] Prometheus metrics and alerting hooks
- [ ] Bulk actions across several nodes at once
- [ ] Container image and Helm chart for NodePilot itself

## Done

Shipped items are tracked in [CHANGELOG.md](CHANGELOG.md).
