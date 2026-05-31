'use client'

import Typography from '@mui/material/Typography'

import type { Installation, NetworkConfig, SystemCheckItem, Validator } from './types'
import { ActionCard, type ChipStatusColor } from './ActionCard'

// ─── System Check Card ──────────────────────────────────────────────

export function SystemCheckCard({
  systemChecks, onClick, deploymentMode
}: { systemChecks: SystemCheckItem[]; onClick: () => void; deploymentMode?: string }) {
  const hasResults = systemChecks.length > 0
  const passed = systemChecks.filter(c => c.status === 'pass').length
  const failed = systemChecks.filter(c => c.status === 'fail').length
  const warned = systemChecks.filter(c => c.status === 'warn').length
  const allPass = hasResults && failed === 0 && warned === 0
  const hasIssues = failed > 0 || warned > 0

  const chipLabel = hasResults
    ? (allPass ? 'Healthy' : hasIssues ? `${failed + warned} issues` : 'OK')
    : undefined

  const chipColor: ChipStatusColor = allPass
    ? 'success'
    : hasIssues
      ? (failed > 0 ? 'error' : 'warning')
      : 'default'

  const accentBar = hasResults
    ? allPass
      ? 'linear-gradient(90deg, var(--mui-palette-success-main), var(--mui-palette-success-light))'
      : hasIssues
        ? 'linear-gradient(90deg, var(--mui-palette-warning-main), var(--mui-palette-error-main))'
        : 'linear-gradient(90deg, var(--mui-palette-primary-main), transparent)'
    : 'linear-gradient(90deg, var(--mui-palette-primary-main), transparent)'

  return (
    <ActionCard
      icon='tabler-cpu'
      title='System Check'
      caption={deploymentMode === 'k8s' ? 'Resources · Kubernetes · IP Whitelist' : 'Resources · Docker · IP Whitelist'}
      chipLabel={chipLabel}
      chipColor={chipColor}
      accentColor='primary'
      customAccentBar={accentBar}
      showBackgroundPattern
      onClick={onClick}
      extra={hasResults ? (
        <div className='flex items-center gap-3 mt-1.5'>
          <div className='flex items-center gap-1'>
            <i className='tabler-circle-check text-success text-sm' />
            <Typography variant='caption' fontWeight={600}>{passed}</Typography>
          </div>
          {warned > 0 && (
            <div className='flex items-center gap-1'>
              <i className='tabler-alert-triangle text-warning text-sm' />
              <Typography variant='caption' fontWeight={600}>{warned}</Typography>
            </div>
          )}
          {failed > 0 && (
            <div className='flex items-center gap-1'>
              <i className='tabler-circle-x text-error text-sm' />
              <Typography variant='caption' fontWeight={600}>{failed}</Typography>
            </div>
          )}
        </div>
      ) : undefined}
    />
  )
}

// ─── Canton Installation Card ──────────────────────────────────────

export function CantonInstallationCard({
  validator, installing, installations, systemChecks, k8sReady, onClick
}: {
  validator: Validator
  installing: boolean
  installations: Installation[]
  systemChecks: SystemCheckItem[]
  k8sReady?: boolean
  onClick: () => void
}) {
  const state = validator.installState
  const isInstalled = state === 'Installed'
  const isInstalling = state === 'Installing' || installing
  const hasError = state === 'InstallError'

  const sysCheckHasResults = systemChecks.length > 0
  const sysCheckFailed = systemChecks.filter(c => c.status === 'fail').length
  const sysCheckWarned = systemChecks.filter(c => c.status === 'warn').length
  const sysCheckPassed = sysCheckHasResults && sysCheckFailed === 0 && sysCheckWarned === 0

  // In K8s mode, Canton Installation also requires the K8s connection card
  // to be fully completed (cluster reachable + namespace created).
  const isK8s = validator.deploymentMode === 'k8s'
  const k8sGatePassed = !isK8s || k8sReady === true

  // Helm-based Canton install for K8s mode lands in Phase 3.
  // Until then, hard-disable the card in K8s mode so users don't trigger
  // the docker-compose path (which would fail on "MISSING: docker").
  const k8sInstallNotReady = isK8s

  const canClick = !k8sInstallNotReady && (isInstalled || (sysCheckPassed && k8sGatePassed))

  const blockedReason = k8sInstallNotReady
    ? 'Helm install — coming in Phase 3'
    : !sysCheckHasResults
      ? 'Run System Check first'
      : !sysCheckPassed
        ? 'Resolve System Check issues first'
        : !k8sGatePassed
          ? 'Complete K8s Connection first'
          : null

  const accent = !canClick
    ? 'default'
    : isInstalled
      ? 'success'
      : hasError
        ? 'error'
        : isInstalling
          ? 'warning'
          : 'primary'

  return (
    <ActionCard
      icon='tabler-package'
      title='Canton Installation'
      chipLabel={state}
      chipColor={isInstalled ? 'success' : hasError ? 'error' : isInstalling ? 'warning' : 'default'}
      accentColor={accent}
      canClick={canClick}
      blockedReason={blockedReason}
      iconAnimation={isInstalling ? 'pulse' : undefined}
      onClick={onClick}
      caption={
        !canClick
          ? blockedReason
          : isInstalled
            ? installations.length > 1
              ? `Splice ${validator.spliceVersion} active · ${installations.length} versions installed`
              : `Splice ${validator.spliceVersion} · ${validator.installPath}`
            : hasError
              ? validator.installError ?? 'Installation failed'
              : 'Download & extract Splice node files'
      }
    />
  )
}

// ─── Network Config Card ───────────────────────────────────────────

export function NetworkConfigCard({
  netConfig, installations, onClick
}: {
  netConfig: NetworkConfig | null
  installations: Installation[]
  onClick: () => void
}) {
  const installedReady = installations.length > 0 && installations.some(i => i.isActive)
  const canClick = installedReady
  const isConfigured = !!(netConfig?.migrationId && netConfig?.sponsorSvUrl && netConfig?.scanUrl && netConfig?.sequencerUrl && netConfig?.partyHint && netConfig?.hasOnboardingSecret)
  const blockedReason = !installedReady ? 'Install Splice first' : null

  return (
    <ActionCard
      icon='tabler-network'
      title='Network Config'
      chipLabel={isConfigured ? 'Configured' : undefined}
      chipColor='success'
      accentColor={!canClick ? 'default' : isConfigured ? 'success' : 'primary'}
      canClick={canClick}
      blockedReason={blockedReason}
      onClick={onClick}
      caption={
        !canClick
          ? blockedReason
          : isConfigured
            ? `${netConfig!.partyHint} · migration ${netConfig!.migrationId}`
            : 'Sponsor SV · onboarding secret · party hint'
      }
    />
  )
}

// ─── Public Access Card ────────────────────────────────────────────

export function PublicAccessCard({
  netConfig, validator, onClick
}: {
  netConfig: NetworkConfig | null
  validator: { runState: string } | null
  onClick: () => void
}) {
  const networkConfigured = !!(netConfig?.migrationId && netConfig?.sponsorSvUrl && netConfig?.scanUrl && netConfig?.sequencerUrl && netConfig?.partyHint && netConfig?.hasOnboardingSecret)
  const validatorRunning = validator?.runState === 'Running'
  const canClick = networkConfigured && validatorRunning
  const mode = netConfig?.publicAccessMode ?? 'direct'
  const hasDomain = mode === 'domain' && !!netConfig?.walletDomain
  const isConfigured = mode === 'domain' && hasDomain

  const blockedReason = !networkConfigured
    ? 'Configure Network first'
    : !validatorRunning
      ? 'Start Validator first'
      : null

  const accent = !canClick
    ? 'default'
    : isConfigured
      ? 'success'
      : mode === 'direct' && netConfig?.configuredAt
        ? 'info'
        : 'primary'

  let statusLabel = 'Not set'
  let chipColor: ChipStatusColor = 'default'

  if (isConfigured) {
    statusLabel = netConfig?.sslEnabled ? 'HTTPS' : 'HTTP'
    chipColor = 'success'
  } else if (mode === 'direct' && netConfig?.configuredAt) {
    statusLabel = 'Direct IP'
    chipColor = 'info'
  } else if (mode === 'domain' && !hasDomain) {
    statusLabel = 'Incomplete'
    chipColor = 'warning'
  }

  return (
    <ActionCard
      icon='tabler-world-www'
      title='Public Access'
      chipLabel={statusLabel}
      chipColor={chipColor}
      accentColor={accent}
      canClick={canClick}
      blockedReason={blockedReason}
      onClick={onClick}
      caption={
        !canClick
          ? blockedReason
          : isConfigured
            ? `${netConfig!.walletDomain}${netConfig?.sslEnabled ? (netConfig?.sslCertificateId ? ' \u00b7 SSL (custom cert)' : ' \u00b7 SSL (Let\u2019s Encrypt)') : ''}`
            : mode === 'direct' && netConfig?.configuredAt
              ? 'Direct IP — OIDC unavailable'
              : 'Domain & SSL · required for OIDC'
      }
    />
  )
}

// ─── Auth Configuration Card ───────────────────────────────────────

export function AuthConfigCard({
  netConfig, onClick
}: {
  netConfig: NetworkConfig | null
  onClick: () => void
}) {
  const networkConfigured = !!(netConfig?.migrationId && netConfig?.sponsorSvUrl && netConfig?.scanUrl && netConfig?.sequencerUrl && netConfig?.partyHint && netConfig?.hasOnboardingSecret)
  const domainConfigured = netConfig?.publicAccessMode === 'domain' && !!netConfig?.walletDomain
  const canClick = networkConfigured && domainConfigured
  const isEnabled = !!netConfig?.authEnabled
  const isConfigured = isEnabled && !!(netConfig?.authUrl && netConfig?.ledgerApiAudience && netConfig?.validatorClientId && netConfig?.hasValidatorClientSecret)

  const blockedReason = !networkConfigured
    ? 'Configure Network first'
    : !domainConfigured
      ? 'Configure Public Access (Custom Domain) first'
      : null

  const accent = !canClick
    ? 'default'
    : isConfigured
      ? 'success'
      : isEnabled
        ? 'warning'
        : 'primary'

  const statusLabel = isConfigured ? 'Configured' : isEnabled ? 'Incomplete' : 'Disabled'
  const chipColor: ChipStatusColor = isConfigured ? 'success' : isEnabled ? 'warning' : 'default'

  return (
    <ActionCard
      icon='tabler-shield-lock'
      title='Authentication'
      chipLabel={statusLabel}
      chipColor={chipColor}
      accentColor={accent}
      canClick={canClick}
      blockedReason={blockedReason}
      onClick={onClick}
      caption={
        !canClick
          ? blockedReason
          : isConfigured
            ? `${netConfig!.validatorClientId} · ${new URL(netConfig!.authUrl).host}`
            : isEnabled
              ? 'Auth enabled — finish OIDC fields'
              : 'OIDC issuer · client credentials · admin user'
      }
    />
  )
}

// ─── Start / Stop Validator Card ───────────────────────────────────

export function StartStopValidatorCard({
  validator, netConfig, startBusy, onAction
}: {
  validator: Validator | null
  netConfig: NetworkConfig | null
  startBusy: boolean
  onAction: (action: 'start' | 'stop') => void
}) {
  const installed = validator?.installState === 'Installed' && !!validator?.installPath
  const networkComplete = !!(netConfig?.migrationId && netConfig?.sponsorSvUrl && netConfig?.scanUrl && netConfig?.sequencerUrl && netConfig?.partyHint)
  const firstStartReady = !!netConfig?.firstStartedAt || !!netConfig?.hasOnboardingSecret
  const canClick = installed && networkComplete && firstStartReady && !startBusy

  const blockedReason = !installed
    ? 'Install Splice node first'
    : !networkComplete
      ? 'Complete Network Config first'
      : !firstStartReady
        ? 'Onboarding secret required for first start'
        : null

  const runState = validator?.runState ?? 'Stopped'
  const isRunning = runState === 'Running'
  const isBusy = runState === 'Starting' || runState === 'Stopping' || startBusy
  const hasError = runState === 'StartError'

  let statusLabel = 'Stopped'
  let chipColor: ChipStatusColor = 'default'
  let accent: 'success' | 'error' | 'info' | 'primary' | 'default' = 'primary'
  let iconClass = 'tabler-player-play'

  if (isRunning) {
    statusLabel = 'Running'
    chipColor = 'success'
    accent = 'success'
    iconClass = 'tabler-player-stop'
  } else if (isBusy) {
    statusLabel = runState
    chipColor = 'info'
    accent = 'info'
    iconClass = 'tabler-loader-2'
  } else if (hasError) {
    statusLabel = 'Start Error'
    chipColor = 'error'
    accent = 'error'
    iconClass = 'tabler-alert-triangle'
  } else if (!canClick) {
    accent = 'default'
    iconClass = 'tabler-lock'
  }

  const subText = !canClick
    ? blockedReason
    : isRunning
      ? `Started ${validator?.lastStartedAt ? new Date(validator.lastStartedAt).toLocaleString() : 'recently'}`
      : hasError
        ? (validator?.lastStartError?.slice(0, 80) ?? 'Last start failed')
        : netConfig?.firstStartedAt
          ? 'Restart validator (start.sh)'
          : 'First start — onboard validator'

  return (
    <ActionCard
      icon={iconClass}
      title={isRunning ? 'Stop Validator' : netConfig?.firstStartedAt ? 'Start Validator' : 'Start (First Time)'}
      chipLabel={statusLabel}
      chipColor={chipColor}
      accentColor={accent}
      canClick={canClick}
      blockedReason={blockedReason}
      iconAnimation={isBusy ? 'spin' : undefined}
      forceActive={isBusy}
      trailingIcon={isRunning ? 'tabler-player-stop' : 'tabler-player-play'}
      caption={subText}
      onClick={() => onAction(isRunning ? 'stop' : 'start')}
    />
  )
}

// ─── Keycloak Setup Card ───────────────────────────────────────────

export function KeycloakSetupCard({
  netConfig, deploying, onClick
}: {
  netConfig: NetworkConfig | null
  deploying: boolean
  onClick: () => void
}) {
  const isDeployed = !!netConfig?.keycloakDeployedAt
  const realm = netConfig?.keycloakRealm ?? 'canton'
  const port = netConfig?.keycloakPort ?? 8180

  // Keycloak binds to 127.0.0.1 — it needs the nginx proxy (deployed by
  // Configure Domain) to be reachable via HTTPS. Block until nginx is up.
  const nginxReady = !!netConfig?.nginxDeployedAt
  const blocked = !nginxReady && !isDeployed

  const chipLabel = deploying ? 'Deploying…' : isDeployed ? 'Running' : 'Not deployed'
  const chipColor: ChipStatusColor = deploying ? 'info' : isDeployed ? 'success' : 'default'

  const accent = deploying ? 'info' : isDeployed ? 'success' : blocked ? 'default' : 'primary'

  const caption = deploying
    ? 'Deploying Keycloak on VPS…'
    : blocked
      ? 'Configure Domain first (Public Access → Configure Domain)'
      : isDeployed
        ? `Port ${port} · realm "${realm}" · Auth Config pre-filled`
        : 'Self-hosted OIDC server — optional, works with DevNet / TestNet / MainNet'

  return (
    <ActionCard
      icon='tabler-key'
      title='Keycloak Setup'
      chipLabel={chipLabel}
      chipColor={chipColor}
      accentColor={accent}
      canClick={!deploying && !blocked}
      blockedReason={blocked ? 'Configure Domain first' : undefined}
      iconAnimation={deploying ? 'pulse' : undefined}
      forceActive={deploying}
      onClick={onClick}
      caption={caption}
    />
  )
}

// ─── K8s Public Access Card ─────────────────────────────────────────

export function K8sPublicAccessCard({
  exposedPorts, ingressDomain, onClick
}: {
  exposedPorts: { wallet: number } | null
  ingressDomain: string | null
  onClick: () => void
}) {
  const hasIngress  = !!ingressDomain
  const hasNodePort = !!exposedPorts

  let caption    = 'NodePort · Ingress · Domain & TLS'
  let chipLabel: string | undefined
  let chipColor: ChipStatusColor = 'default'
  let accentColor: 'success' | 'info' | 'primary' = 'primary'

  if (hasIngress) {
    caption    = `${ingressDomain} · ${hasNodePort ? 'NodePort + Ingress' : 'Ingress'}`
    chipLabel  = 'Configured'
    chipColor  = 'success'
    accentColor = 'success'
  } else if (hasNodePort) {
    caption    = `NodePort :${exposedPorts!.wallet} · Direct access`
    chipLabel  = 'NodePort'
    chipColor  = 'info'
    accentColor = 'info'
  }

  return (
    <ActionCard
      icon='tabler-world-www'
      title='Public Access'
      chipLabel={chipLabel}
      chipColor={chipColor}
      accentColor={accentColor}
      canClick
      onClick={onClick}
      caption={caption}
    />
  )
}

