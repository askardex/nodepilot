# NodePilot

A management console for Canton Network validator nodes. NodePilot handles the
parts of running a validator that are tedious to do by hand: provisioning a host,
installing the Splice stack, wiring up Keycloak and TLS, and keeping an eye on the
node once it is live.

It runs two ways. Point it at a plain Linux box over SSH and it drives Docker
Compose for you, or hand it a kubeconfig and it deploys the same stack with Helm.
Either way you work from one dashboard instead of a pile of shell scripts.

## What it does

- Connect to a remote host over SSH and install a Canton validator end to end
- Deploy to Kubernetes through Helm when you'd rather run on a cluster
- Switch between DevNet, TestNet and MainNet without rebuilding config by hand
- Track CPU, memory, disk and network for each node from the validator detail page
- Configure the public-facing domain, run DNS checks and request Let's Encrypt certs
- Stand up Keycloak for validator authentication and rotate the operator secrets
- Store SSH passwords, private keys and onboarding secrets encrypted at rest

## Requirements

- Node.js 20 or newer
- pnpm 9+
- A target host you can reach over SSH, or a Kubernetes cluster and its kubeconfig

## Running it locally

```bash
pnpm install
cp .env.example .env
```

Open `.env` and set `AUTH_SECRET` to a random value before you start:

```bash
openssl rand -base64 32
```

Then apply the database schema and start the dev server:

```bash
pnpm prisma migrate deploy
pnpm dev
```

The app is served at http://localhost:3000.

### First login

Registration is open only until the first account exists. Create your account on
the register page, and from that point the endpoint closes itself. Manage the
instance with that first user.

## Configuration

All runtime settings live in `.env`. The defaults in `.env.example` use a local
SQLite file, which is fine for a single operator. For a shared deployment, point
`DATABASE_URL` at PostgreSQL and run the migrations again.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Prisma connection string (SQLite by default) |
| `AUTH_SECRET` | Signing key for NextAuth sessions — required |
| `AUTH_TRUST_HOST` | Set to `true` when running behind a proxy |

Secrets that belong to a validator (SSH credentials, onboarding secret, Keycloak
passwords) are encrypted with a key derived from `SECRET_ENCRYPTION_KEY`, falling
back to `AUTH_SECRET` if that isn't set.

## Built with

Next.js 16 (App Router) and MUI 7 on the front end, NextAuth v5 for sessions,
Prisma for storage, `ssh2` for the Compose path and `@kubernetes/client-node`
for the Helm path.

The UI layer is built on top of the
[Materio Free MUI Next.js Admin Template](https://github.com/themeselection/materio-mui-nextjs-admin-template-free)
by ThemeSelection, used under the MIT License.

## Project status

See [CHANGELOG.md](CHANGELOG.md) for release history and [ROADMAP.md](ROADMAP.md)
for what's planned next. Current release: **v1.1.0**.

## License

Released under the MIT License. See [LICENSE](LICENSE).
