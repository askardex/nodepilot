# Roadmap

This is a working plan, not a promise. Items move as priorities shift and as the
Canton/Splice releases land. Current release: **v1.1.0**.

## Scope

NodePilot is a tool a single operator runs to manage their own validator. It is
**not** a SaaS product and there is no multi-tenant or multi-user account model —
one operator, one console, the validators they own. The "users" NodePilot helps
manage are the wallet users and parties *inside* a validator, which is a different
thing from who logs into NodePilot.

Network-level onboarding happens outside the tool: you give your egress IP to an
SV sponsor for the allowlist, and you get an onboarding secret from them (self-serve
on DevNet, manual on TestNet/MainNet). NodePilot picks up once you have a secret
and a reachable host. Reference:
[Validator Onboarding Process](https://docs.canton.network/global-synchronizer/deployment/onboarding-process).

Every item below maps to the official Canton validator docs so the behaviour stays
aligned with upstream rather than reinvented.

## Working today (v1.1.0)

- Docker Compose deployment over SSH, install runs through to completion
- Domain / DNS configuration
- Let's Encrypt TLS provisioning
- Keycloak brought up as part of the stack

## Known issues

Real gaps in the current release, listed so nobody is surprised.

- **Wallet users are keyed off the raw Keycloak subject ID.** New users get
  identified by the OIDC subject instead of a chosen, human-readable party, so the
  account-to-party mapping isn't where it should be.
- **Every onboarded account ends up with validator status.** There's no separation
  yet between the validator operator's party and a regular wallet user's party.
- **Keycloak setup is fragile.** It comes up, but the realm/client wiring needs to
  be made idempotent before it's dependable.

## v1.2.0 — User and party onboarding

The priority. The fix is already described upstream in
[Validator Users and Wallets](https://docs.canton.network/global-synchronizer/deployment/validator-users):
the validator exposes `POST /api/validator/v0/admin/users` with three modes, and
NodePilot should drive it instead of letting every user auto-onboard a fresh party
off their Keycloak ID.

- [ ] Pre-create a user via the admin API so the "Onboard yourself" path is skipped
- [ ] Custom party hint mode: allocate `name::namespace` parties with readable hints
- [ ] Associate-with-existing-party mode: point a user at the operator's wallet
- [ ] Separate the operator party from ordinary wallet-user parties in the UI
- [ ] Show the resolved Party ID and mode for each user in the list
- [ ] Make Keycloak realm/client provisioning idempotent and repeatable

## v1.3.0 — Backups

Mapped to
[Validator Backups](https://docs.canton.network/global-synchronizer/production-operations/validator-backups).
Two distinct backups are needed, and the order matters.

- [ ] Pull the node identities backup from `/v0/admin/participant/identities`
- [ ] Treat the identities dump as a secret (it holds participant private keys) and
      push it to an external store, never into the repo or the cluster
- [ ] Postgres dumps of both the validator-app and participant databases
- [ ] Enforce the ordering rule: validator-app dump must precede the participant dump
- [ ] Scheduled backups (target every 4 hours) with a retention window

## v1.4.0 — Updates

Mapped to
[Validator Upgrades](https://docs.canton.network/global-synchronizer/production-operations/validator-upgrades).
Only version upgrades need operator action; protocol upgrades don't.

- [ ] Detect installed Splice version against the network's expected version
- [ ] Compose upgrade by swapping the **full** bundle (compose file + start.sh +
      `IMAGE_TAG`), not just the image tag
- [ ] Guard rails: never drop Postgres, change migration IDs, or rotate secrets
      during a version upgrade
- [ ] Surface the relevant release notes before the operator confirms

## v1.5.0 — Disaster recovery

Mapped to
[Validator Disaster Recovery](https://docs.canton.network/global-synchronizer/production-operations/validator-disaster-recovery).

- [ ] Restore a node from a Postgres backup (and warn when it's over 30 days old)
- [ ] Re-onboard from an identities backup, keeping the same party hint and reusing
      the existing onboarding secret
- [ ] Flag that users onboarded after the backup must be re-onboarded by hand

## v1.6.0 — KMS-backed keys (GCP / AWS)

Mapped to
[Validator Security](https://docs.canton.network/global-synchronizer/production-operations/validator-security).
This is a Kubernetes-only capability and comes with hard constraints worth stating
up front.

- [ ] GCP KMS config on the participant Helm chart (`kms.type: gcp`, location /
      project / key ring, `GOOGLE_APPLICATION_CREDENTIALS` secret)
- [ ] AWS KMS config (`kms.type: aws`, region, access-key secret)
- [ ] Make clear in the UI that KMS is **fresh-install only** — you cannot migrate
      an existing non-KMS validator onto a KMS
- [ ] Note the upstream caveat that the GCP/AWS KMS drivers require a licensed
      Canton Enterprise

> KMS is not available for Docker Compose deployments, so it depends on the
> Kubernetes path below being solid first.

## v1.7.0 — Kubernetes parity

The Helm path exists but does not yet deploy a working validator end to end.

- [ ] Bring the Helm install to parity with the Compose path
- [ ] Validate ingress, TLS and Keycloak on the cluster
- [ ] Document the kubeconfig and chart-value requirements
- [ ] Unblock the KMS work above, which only runs on Kubernetes

## v1.8.0 — Operations and monitoring

- [ ] Start / stop / restart a validator from the dashboard
- [ ] Tail install and runtime logs in the browser
- [ ] Scheduled health checks with status history per node

## Under consideration

Not scheduled, may not happen.

- [ ] Prometheus metrics and alerting hooks
- [ ] Bulk actions across several nodes at once
- [ ] Container image and Helm chart for NodePilot itself

## Done

Shipped items are tracked in [CHANGELOG.md](CHANGELOG.md).
