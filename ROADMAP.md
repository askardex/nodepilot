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

## v1.6.0 — KMS-backed keys

There are two separate things people mean by "KMS" here, and they have very
different constraints.

**Participant keys (Canton-side).** Storing the validator participant's protocol
and namespace keys in a KMS is a Canton *Enterprise* feature, mapped in
[Validator Security](https://docs.canton.network/global-synchronizer/production-operations/validator-security)
and [KMS Operations](https://docs.canton.network/global-synchronizer/production-operations/kms-operations).
Canton does expose a [KMS Driver API](https://docs.canton.network/global-synchronizer/reference/kms-driver-guide)
for custom integrations, but the API artifact and the `kms` crypto provider both
require a licensed Canton Enterprise build — a custom driver does not get you
around that. The driver guide states it plainly: *"You must have a Canton
enterprise license and account to access the artifact,"* and the KMS node runs as
`CantonEnterpriseApp`. The KMS Operations page likewise marks the AWS and GCP
providers as Enterprise-only. The community Splice validator uses the `jce`
provider with keys in the database. So NodePilot can *configure and wire up* KMS
for operators who have Enterprise, but it cannot enable it on a community node.

- [ ] GCP KMS wiring on the participant Helm chart (`kms.type: gcp`, location /
      project / key ring, `GOOGLE_APPLICATION_CREDENTIALS` secret) — Enterprise only
- [ ] AWS KMS wiring (`kms.type: aws`, region, access-key secret) — Enterprise only
- [ ] Make clear in the UI that this is Kubernetes-only, fresh-install only, and
      needs a Canton Enterprise license

**NodePilot's own secret store (our side).** This is fully in our control and does
not depend on any Canton license. NodePilot already encrypts the secrets it stores
(SSH credentials, onboarding secret) with AES-256-GCM in `src/lib/secrets.ts`. We
can take that further:

- [ ] Envelope-encrypt NodePilot's secret store with GCP or AWS KMS (KMS holds the
      wrapper key, NodePilot stores only ciphertext)
- [ ] Push the node identities backup to a cloud Secret Manager rather than disk

> The participant-key half is Kubernetes-only, so it depends on the Kubernetes
> path below being solid first. The NodePilot-side half works on any deployment.

### Key protection without Enterprise

A KMS keeps the participant key inside hardware so it never leaves. Without an
Enterprise licence the keys live in the participant database under the `jce`
provider, but that does not mean they have to sit unprotected. These steps raise
the bar a lot, cost nothing, and work on any deployment:

- [ ] Encrypt the disk / volume holding the participant database (LUKS or the
      cloud provider's disk encryption)
- [ ] Host hardening: restrict database access, no key export, lock down egress
- [ ] Store the node identities backup encrypted in a cloud Secret Manager rather
      than on plain disk

> This is "keys encrypted at rest", not "keys never leave the HSM". It is not a
> substitute for KMS, but for most operators it is a sensible baseline while the
> Enterprise KMS path stays optional.

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
