# Roadmap

This is a working plan, not a promise. Items move around as priorities shift and
as the Canton/Splice releases land. The current release is **v1.1.0**.

## v1.2.0 — Operations

The next release is about making a running node easier to live with.

- [ ] Start, stop and restart a validator from the dashboard without SSH
- [ ] Tail install and runtime logs in the browser
- [ ] Health checks on a schedule with status history per node
- [ ] One-click upgrade between Splice versions
- [ ] Export and import a validator's config as a single file

## v1.3.0 — Multi-user

- [ ] Roles: admin and read-only viewer
- [ ] Per-user audit log of actions taken against a node
- [ ] Optional PostgreSQL setup guide for shared deployments
- [ ] Invite flow to replace bootstrap-only registration

## v1.4.0 — Observability

- [ ] Prometheus metrics endpoint for scraped monitoring
- [ ] Alerting hooks (webhook / email) on node down or sync lag
- [ ] Historical charts for traffic and balance over time

## Under consideration

These aren't scheduled yet and may not happen.

- [ ] Backup and restore of validator identity
- [ ] Bulk actions across several nodes at once
- [ ] CLI companion for headless automation
- [ ] Container image and Helm chart for NodePilot itself

## Done

Shipped items are tracked in [CHANGELOG.md](CHANGELOG.md).
