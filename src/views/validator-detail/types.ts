// Shared types for the Validator Detail page.
// Extracted from ValidatorDetailPage.tsx to keep the main file maintainable.

export type SystemCheckItem = { name: string; value: string; status: string }

export type ServerStats = {
  cpuUsage: number
  ramUsed: number
  ramTotal: number
  diskUsed: number
  diskTotal: number
  diskPercent: number
  loadAvg: string
  uptimeSeconds: number
  dockerRunning: number
  dockerTotal: number
  // K8s mode (only populated when validator.deploymentMode === 'k8s')
  podsRunning?: number
  podsTotal?: number
  networkRx: string
  networkTx: string
}

export type Validator = {
  id: string
  name: string
  host: string
  sshPort: number
  network: string
  deploymentMode: string
  validatorPort: number
  version: string | null
  partyId: string | null
  synchronizerId: string | null
  hostname: string | null
  status: string
  uptime: string | null
  lastSyncAt: string | null
  lastHealthCheck: string | null
  installState: string
  spliceVersion: string | null
  installPath: string | null
  installError: string | null
  installedAt: string | null
  runState: string
  lastStartedAt: string | null
  lastStoppedAt: string | null
  lastStartError: string | null
  createdAt: string
  updatedAt: string
}

export const statusColor: Record<string, 'success' | 'error' | 'warning' | 'default' | 'info'> = {
  Online: 'success',
  Offline: 'default',
  Error: 'error',
  Unconfigured: 'warning',
  Installing: 'info'
}

// Apply-domain SSE stream types (used by Stage 5d dialog)
export type SslLog = { timestamp: string; level: string; message: string }
export type SslProbe = { name: string; fqdn: string; url: string; code: number; ok: boolean }
export type SslSummary = { ok: boolean; stage: string; probes?: SslProbe[]; spliceNginxPort?: number }

// Start/Stop SSE stream types (used by Stage 6 dialog)
export type StartLog = { timestamp: string; level: string; message: string }

// Stage 3+4+5 — Network/Auth/Public-Access combined config returned by /config endpoint.
export type NetworkConfig = {
  migrationId: number | null
  sponsorSvUrl: string
  scanUrl: string
  sequencerUrl: string
  partyHint: string
  disableBft: boolean
  hasOnboardingSecret: boolean
  configuredAt: string | null
  firstStartedAt: string | null

  // Stage 4 — Auth
  authEnabled: boolean
  authUrl: string
  authJwksUrl: string
  authWellknownUrl: string
  ledgerApiAudience: string
  ledgerApiScope: string
  ledgerApiAdminUser: string
  validatorAudience: string
  validatorClientId: string
  walletAdminUser: string
  walletUiClientId: string
  ansUiClientId: string
  contactPoint: string
  hasValidatorClientSecret: boolean

  // Stage 5 — Public Access (domain & SSL via nginx)
  publicAccessMode: 'direct' | 'domain'
  routingMode: 'multi' | 'path'
  baseDomain: string
  enableWallet: boolean
  walletSubdomain: string
  enableAns: boolean
  ansSubdomain: string
  enableApi: boolean
  apiSubdomain: string
  enableMetrics: boolean
  metricsSubdomain: string
  enableGrpcLedger: boolean
  grpcLedgerSubdomain: string
  portLedgerApi: number
  portWalletUi: number
  portJsonApi: number
  portValidatorApi: number
  portSpliceNginx: number
  walletDomain: string
  ansDomain: string
  validatorDomain: string
  sslEnabled: boolean
  sslEmail: string
  sslCertificateId: string | null
  nginxDeployedAt: string | null

  // Stage 6 — Advanced (auto top-up traffic)
  autoTopUpEnabled: boolean
  trafficThroughput: number | null
  trafficTopupInterval: string

  // Keycloak — Nodepilot-managed OIDC server
  keycloakEnabled: boolean
  keycloakPort: number | null
  keycloakRealm: string
  hasKeycloakAdminPass: boolean
  hasKeycloakOperatorPass: boolean
  keycloakDeployedAt: string | null

  // Expose Keycloak via nginx reverse proxy
  enableKeycloak: boolean
  keycloakSubdomain: string
}

// Stage 3 — Network form (subset of NetworkConfig actually edited in the modal)
export type NetworkForm = {
  migrationId: string
  sponsorSvUrl: string
  scanUrl: string
  sequencerUrl: string
  onboardingSecret: string
  partyHint: string
  disableBft: boolean
  autoTopUpEnabled: boolean
  trafficThroughput: string
  trafficTopupInterval: string
}

// DNS verification result row for each FQDN
export type DnsResult = { fqdn: string; a: string[]; aaaa: string[]; matches: boolean; cfProxied?: boolean; ok: boolean; error: string | null }

// Stage 5 — Public Access form (subset of NetworkConfig public-access fields edited in modal)
export type PublicForm = {
  publicAccessMode: 'direct' | 'domain'
  routingMode: 'multi' | 'path'
  baseDomain: string
  enableWallet: boolean
  walletSubdomain: string
  enableAns: boolean
  ansSubdomain: string
  enableApi: boolean
  apiSubdomain: string
  enableMetrics: boolean
  metricsSubdomain: string
  enableGrpcLedger: boolean
  grpcLedgerSubdomain: string
  enableKeycloak: boolean
  keycloakSubdomain: string
  portLedgerApi: number
  portWalletUi: number
  portJsonApi: number
  portValidatorApi: number
  portSpliceNginx: number
  sslEnabled: boolean
  sslMode: 'letsencrypt' | 'custom'
  sslEmail: string
  customCertPem: string
  customKeyPem: string
}

// Splice version installed on the validator host
export type Installation = { id: string; version: string; installPath: string; isActive: boolean; installedAt: string }

// GitHub release entry from /api/splice-releases
export type Release = { tag: string; version: string; name: string; publishedAt: string; prerelease: boolean }

// Single step inside an install streaming session
export type InstallStep = { step: string; status: string; message?: string; progress?: number }

// Stage 4 — Auth form (subset of NetworkConfig actually edited in the modal,
// plus a write-only validatorClientSecret field that's never read back from the API)
export type AuthForm = {
  authEnabled: boolean
  authUrl: string
  authJwksUrl: string
  authWellknownUrl: string
  ledgerApiAudience: string
  ledgerApiScope: string
  ledgerApiAdminUser: string
  validatorAudience: string
  validatorClientId: string
  validatorClientSecret: string
  walletAdminUser: string
  walletUiClientId: string
  ansUiClientId: string
  contactPoint: string
}

