'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'

import { useParams, useRouter } from 'next/navigation'

import Grid from '@mui/material/Grid'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import IconButton from '@mui/material/IconButton'

import type { ServerStats, Validator, SslLog, SslSummary, StartLog, NetworkConfig, DnsResult, Installation, Release, InstallStep } from './validator-detail/types'
import { statusColor } from './validator-detail/types'
import { LogStreamDialog } from './validator-detail/LogStreamDialog'
import { StatDetailDialog } from './validator-detail/StatDetailDialog'
import { SystemCheckDialog } from './validator-detail/SystemCheckDialog'
import { ServerMonitorPanel } from './validator-detail/ServerMonitorPanel'
import {
  SystemCheckCard,
  CantonInstallationCard,
  NetworkConfigCard,
  PublicAccessCard,
  AuthConfigCard,
  StartStopValidatorCard,
  KeycloakSetupCard,
  K8sPublicAccessCard
} from './validator-detail/StageCards'
import { NetworkConfigDialog } from './validator-detail/NetworkConfigDialog'
import { AuthConfigDialog } from './validator-detail/AuthConfigDialog'
import { InstallVersionDialog } from './validator-detail/InstallVersionDialog'
import { PublicAccessDialog } from './validator-detail/PublicAccessDialog'
import { K8sPublicAccessDialog } from './validator-detail/K8sPublicAccessDialog'
import { KeycloakSetupDialog } from './validator-detail/KeycloakSetupDialog'
import {
  K8sConnectionCard,
  K8sConnectionDialog,
  type K8sConnectionState
} from './validator-detail/K8sConnectionDialog'
import {
  K8sCantonInstallCard,
  K8sCantonInstallDialog,
  type K8sInstallState
} from './validator-detail/K8sCantonInstallDialog'

export default function ValidatorDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [validator, setValidator] = useState<Validator | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [systemChecks, setSystemChecks] = useState<{ name: string; value: string; status: string }[]>(() => {
    if (typeof window === 'undefined') return []

    try {
      const stored = localStorage.getItem(`nodepilot-checks-${id}`)

      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })

  const [checkHistory, setCheckHistory] = useState<{ name: string; value: string; status: string }[]>([])
  const [checkingSystem, setCheckingSystem] = useState(false)
  const [checkDialogOpen, setCheckDialogOpen] = useState(false)
  const [installingPkg, setInstallingPkg] = useState<string | null>(null)

  // K8s connection state (only used when validator.deploymentMode === 'k8s')
  const [k8sDialogOpen, setK8sDialogOpen] = useState(false)
  const [k8sState, setK8sState] = useState<K8sConnectionState>({ connected: false })

  // K8s Canton install (Helm) state
  const [k8sInstallDialogOpen, setK8sInstallDialogOpen] = useState(false)
  const [k8sInstallState, setK8sInstallState] = useState<K8sInstallState>({
    helmReady: false, releaseCount: 0, podsRunning: 0, podsTotal: 0
  })

  // K8s Public Access state
  const [k8sPublicOpen, setK8sPublicOpen] = useState(false)
  const [k8sPublicStatus, setK8sPublicStatus] = useState<{
    exposedPorts: { wallet: number; ans: number; validatorApi: number } | null
    ingressDomain: string | null
  }>({ exposedPorts: null, ingressDomain: null })

  // Hydrate k8sState from server on load (so refresh doesn't lose progress).
  useEffect(() => {
    if (!id) return
    let cancelled = false

    fetch(`/api/validators/${id}/k8s/status`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data.connected) {
          setK8sState({
            connected: true,
            namespace: data.namespace,
            namespaceReady: data.namespaceReady
          })
        }
      })
      .catch(() => {/* ignore — non-k8s validator or network error */})

    return () => { cancelled = true }
  }, [id])

  // Hydrate K8s public access status on load.
  useEffect(() => {
    if (!id) return
    let cancelled = false

    fetch(`/api/validators/${id}/k8s/ingress-status`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        setK8sPublicStatus({
          exposedPorts: d.exposedPorts ?? null,
          ingressDomain: d.ingress?.baseDomain ?? null
        })
      })
      .catch(() => { /* non-fatal */ })

    return () => { cancelled = true }
  }, [id])

  // Server Stats state
  const [serverStats, setServerStats] = useState<ServerStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState('')

  // History for sparklines (keep last 20 data points)
  const [statsHistory, setStatsHistory] = useState<{
    cpu: number[]
    ram: number[]
    disk: number[]
    load: number[]
  }>({ cpu: [], ram: [], disk: [], load: [] })

  // Stat detail modal state
  const [detailModal, setDetailModal] = useState<{ open: boolean; metric: string; title: string; output: string; loading: boolean; logContainer?: string }>({
    open: false, metric: '', title: '', output: '', loading: false
  })

  // Per-metric cached output (so re-opening uses cache; user must press Refresh to re-fetch)
  const [detailCache, setDetailCache] = useState<Record<string, string>>({})

  // Install state
  const [installModalOpen, setInstallModalOpen] = useState(false)
  const [installVersion, setInstallVersion] = useState('')
  const [installCustomUrl, setInstallCustomUrl] = useState('')
  const [installing, setInstalling] = useState(false)
  const [installSteps, setInstallSteps] = useState<InstallStep[]>([])
  const [installLog, setInstallLog] = useState('')
  const [showLog, setShowLog] = useState(false)
  const [releases, setReleases] = useState<Release[]>([])
  const [releasesLoading, setReleasesLoading] = useState(false)
  const [releasesError, setReleasesError] = useState<string | null>(null)

  // List of Splice installations on the validator host (multi-version support)
  const [installations, setInstallations] = useState<Installation[]>([])
  const [installationsLoading, setInstallationsLoading] = useState(false)
  const [busyVersion, setBusyVersion] = useState<string | null>(null) // version currently being activated/uninstalled

  // Stage 3 — Network configuration (sponsor SV, scan, sequencer, onboarding secret, party hint)
  const [netConfig, setNetConfig] = useState<NetworkConfig | null>(null)
  const [netModalOpen, setNetModalOpen] = useState(false)

  // Stage 4 — Auth modal state
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authSaving, setAuthSaving] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  // Provider selection (UI-only — drives placeholders/helper text and templates).
  // Inferred from existing authUrl on load; defaults to Auth0.
  const [authProvider, setAuthProvider] = useState<'auth0' | 'keycloak'>('auth0')

  const [authForm, setAuthForm] = useState({
    authEnabled: false,
    authUrl: '',
    authJwksUrl: '',
    authWellknownUrl: '',
    ledgerApiAudience: '',
    ledgerApiScope: '',
    ledgerApiAdminUser: '',
    validatorAudience: '',
    validatorClientId: '',
    validatorClientSecret: '',
    walletAdminUser: '',
    walletUiClientId: '',
    ansUiClientId: '',
    contactPoint: ''
  })

  // Stage 5 — Public Access modal state (domain & SSL via nginx)
  const [publicModalOpen, setPublicModalOpen] = useState(false)
  const [publicSaving, setPublicSaving] = useState(false)
  const [publicError, setPublicError] = useState<string | null>(null)

  const [publicForm, setPublicForm] = useState({
    publicAccessMode: 'direct' as 'direct' | 'domain',
    routingMode: 'multi' as 'multi' | 'path',
    baseDomain: '',
    enableWallet: true,
    walletSubdomain: 'wallet',
    enableAns: true,
    ansSubdomain: 'ans',
    enableApi: true,
    apiSubdomain: 'api',
    enableMetrics: false,
    metricsSubdomain: 'metrics',
    enableGrpcLedger: false,
    grpcLedgerSubdomain: 'grpc',
    enableKeycloak: false,
    keycloakSubdomain: 'auth',
    portLedgerApi: 5001,
    portWalletUi: 2000,
    portJsonApi: 7575,
    portValidatorApi: 5003,
    portSpliceNginx: 8080,
    sslEnabled: false,
    sslMode: 'letsencrypt' as 'letsencrypt' | 'custom',
    sslEmail: '',
    customCertPem: '',
    customKeyPem: ''
  })

  // Stage 5b — DNS verification state (inline in Public Access modal)
  const [dnsLoading, setDnsLoading] = useState(false)
  const [dnsResults, setDnsResults] = useState<DnsResult[] | null>(null)
  const [dnsExpectedIps, setDnsExpectedIps] = useState<string[]>([])
  const [dnsAllOk, setDnsAllOk] = useState(false)
  const [dnsError, setDnsError] = useState<string | null>(null)

  // Stage 5c — Apply SSL (configure-domain) state — separate dialog with SSE log stream
  const [sslDialogOpen, setSslDialogOpen] = useState(false)
  const [sslApplying, setSslApplying] = useState(false)
  const [sslStatus, setSslStatus] = useState<'idle' | 'running' | 'success' | 'failed'>('idle')
  const [sslLogs, setSslLogs] = useState<SslLog[]>([])
  const [sslError, setSslError] = useState<string | null>(null)
  const [sslSummary, setSslSummary] = useState<SslSummary | null>(null)

  // Stage 6 — Start / Stop validator (start.sh via SSH) — SSE log stream
  const [startDialogOpen, setStartDialogOpen] = useState(false)
  const [startBusy, setStartBusy] = useState(false)
  const [startStatus, setStartStatus] = useState<'idle' | 'running' | 'success' | 'failed'>('idle')
  const [startMode, setStartMode] = useState<'start' | 'stop'>('start')
  const [startLogs, setStartLogs] = useState<StartLog[]>([])
  const [startError, setStartError] = useState<string | null>(null)

  // Keycloak Setup — dialog + SSE deploy stream
  const [keycloakModalOpen, setKeycloakModalOpen] = useState(false)
  const [keycloakDeploying, setKeycloakDeploying] = useState(false)

  const [netForm, setNetForm] = useState({
    migrationId: '',
    sponsorSvUrl: '',
    scanUrl: '',
    sequencerUrl: '',
    onboardingSecret: '',
    partyHint: '',
    disableBft: true,
    autoTopUpEnabled: false,
    trafficThroughput: '200000',
    trafficTopupInterval: '1m'
  })

  const [netSaving, setNetSaving] = useState(false)
  const [netError, setNetError] = useState<string | null>(null)
  const [netSecretBusy, setNetSecretBusy] = useState(false)

  // Per-network defaults loaded from DB (admin-editable presets)
  type NetworkPreset = {
    network: string
    sponsorSvUrl: string
    scanUrl: string
    sequencerUrl: string
    migrationId: number | null
  }
  const [netPresets, setNetPresets] = useState<Record<string, NetworkPreset>>({})

  useEffect(() => {
    let cancelled = false

    fetch('/api/network-presets')
      .then(r => r.json())
      .then(d => {
        if (cancelled || !Array.isArray(d.presets)) return
        const map: Record<string, NetworkPreset> = {}

        for (const p of d.presets) map[p.network] = p
        setNetPresets(map)
      })
      .catch(() => { /* fall through to empty defaults */ })

    return () => { cancelled = true }
  }, [])

  const generateDevnetSecret = useCallback(async () => {
    if (!netForm.sponsorSvUrl) {
      setNetError('Fill Sponsor SV URL first')

      return
    }

    setNetSecretBusy(true)
    setNetError(null)

    try {
      const res = await fetch(`/api/validators/${id}/config/devnet-secret`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sponsorSvUrl: netForm.sponsorSvUrl })
      })

      const data = await res.json()

      if (!res.ok) {
        const msg = data.hint
          ? `${data.error || `HTTP ${res.status}`} — ${data.hint}`
          : (data.error || `HTTP ${res.status}`)

        throw new Error(msg)
      }

      setNetForm(f => ({ ...f, onboardingSecret: data.secret }))
    } catch (err: any) {
      setNetError(err?.message || 'Failed to generate secret')
    } finally {
      setNetSecretBusy(false)
    }
  }, [id, netForm.sponsorSvUrl])

  const fetchValidator = useCallback(async () => {
    try {
      const res = await fetch(`/api/validators/${id}`)

      if (!res.ok) {
        setError('Validator not found')

        return
      }

      const data = await res.json()

      setValidator(data)
    } catch {
      setError('Failed to load validator')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchValidator()
  }, [fetchValidator])

  // Initial load of installations list (independent of fetchInstallations callback hoisting)
  useEffect(() => {
    let cancelled = false

    fetch(`/api/validators/${id}/installations`)
      .then(r => r.json())
      .then(d => {
        if (!cancelled && Array.isArray(d.installations)) setInstallations(d.installations)
      })
      .catch(() => { /* ignore */ })

    return () => { cancelled = true }
  }, [id])

  // Fetch server stats
  const fetchStats = useCallback(async () => {
    setStatsLoading(true)
    setStatsError('')

    try {
      const res = await fetch(`/api/validators/${id}/server-stats`)

      if (!res.ok) {
        const data = await res.json()

        setStatsError(data.error || 'Failed to fetch stats')

        return
      }

      const data = await res.json()

      setServerStats(data)
      setStatsHistory(prev => ({
        cpu:  [...prev.cpu,  data.cpuUsage].slice(-20),
        ram:  [...prev.ram,  Math.round((data.ramUsed / data.ramTotal) * 100)].slice(-20),
        disk: [...prev.disk, data.diskPercent].slice(-20),
        load: [...prev.load, parseFloat(data.loadAvg.split(' ')[0]) || 0].slice(-20)
      }))
    } catch {
      setStatsError('Connection failed')
    } finally {
      setStatsLoading(false)
    }
  }, [id])

  // Poll API every 10s — server-side cache ensures SSH to VPS only every 30s
  useEffect(() => {
    fetchStats()

    const interval = setInterval(fetchStats, 10000)

    return () => clearInterval(interval)
  }, [fetchStats])

  const openStatDetail = useCallback(async (metric: string, title: string, force = false) => {
    // The "docker" metric is volatile (containers restart, change health,
    // get recreated). Always fetch fresh — cache would show stale uptime
    // and may even hide containers that just got recreated.
    const isVolatile = metric === 'docker'

    // Use cache unless forced refresh or the metric is volatile
    const cached = detailCache[metric]

    if (cached && !force && !isVolatile) {
      setDetailModal({ open: true, metric, title, output: cached, loading: false })

      return
    }

    setDetailModal({ open: true, metric, title, output: '', loading: true })

    try {
      const res = await fetch(`/api/validators/${id}/server-stats/detail?metric=${metric}`)
      const data = await res.json()

      if (!res.ok) {
        setDetailModal(prev => ({ ...prev, output: data.error ?? 'Failed to fetch', loading: false }))
      } else {
        setDetailModal(prev => ({ ...prev, output: data.output, loading: false }))
        setDetailCache(prev => ({ ...prev, [metric]: data.output }))
      }
    } catch {
      setDetailModal(prev => ({ ...prev, output: 'Connection failed', loading: false }))
    }
  }, [id, detailCache])

  const openContainerLogs = useCallback(async (containerName: string) => {
    setDetailModal({ open: true, metric: 'dockerlogs', title: `Logs: ${containerName}`, output: '', loading: true, logContainer: containerName })

    try {
      const res = await fetch(`/api/validators/${id}/server-stats/detail?metric=dockerlogs&container=${encodeURIComponent(containerName)}`)
      const data = await res.json()

      if (!res.ok) {
        setDetailModal(prev => ({ ...prev, output: data.error ?? 'Failed to fetch logs', loading: false }))
      } else {
        setDetailModal(prev => ({ ...prev, output: data.output, loading: false }))
      }
    } catch {
      setDetailModal(prev => ({ ...prev, output: 'Connection failed', loading: false }))
    }
  }, [id])

  const backToContainers = useCallback(() => {
    openStatDetail('docker', 'Docker Containers', true)
  }, [openStatDetail])

  const fetchReleases = useCallback(async () => {
    setReleasesLoading(true)
    setReleasesError(null)

    try {
      const res = await fetch('/api/splice-releases')
      const data = await res.json()

      if (!res.ok) {
        setReleasesError(data.error ?? 'Failed to fetch releases')

        return
      }

      const list: Release[] = data.releases ?? []

      setReleases(list)

      if (list.length > 0) {
        setInstallVersion(prev => {
          if (prev) return prev
          const stable = list.find(r => !r.prerelease) ?? list[0]

          return stable.version
        })
      }
    } catch (e) {
      setReleasesError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setReleasesLoading(false)
    }
  }, [])

  const fetchInstallations = useCallback(async () => {
    setInstallationsLoading(true)

    try {
      const res = await fetch(`/api/validators/${id}/installations`)
      const data = await res.json()

      if (res.ok) setInstallations(data.installations ?? [])
    } catch {
      // ignore — list is best-effort
    } finally {
      setInstallationsLoading(false)
    }
  }, [id])

  const activateInstallation = useCallback(async (version: string) => {
    setBusyVersion(version)

    try {
      const res = await fetch(`/api/validators/${id}/installations/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version })
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Failed to activate version')

        return
      }

      setSuccess(`Activated Splice ${version}`)
      await Promise.all([fetchInstallations(), fetchValidator()])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setBusyVersion(null)
    }
  }, [id, fetchInstallations, fetchValidator])

  const uninstallInstallation = useCallback(async (version: string) => {
    if (!confirm(`Uninstall Splice ${version}? This removes its directory on the host.`)) return
    setBusyVersion(version)

    try {
      const res = await fetch(`/api/validators/${id}/installations/activate?version=${encodeURIComponent(version)}`, {
        method: 'DELETE'
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Failed to uninstall')

        return
      }

      setSuccess(`Uninstalled Splice ${version}`)
      await Promise.all([fetchInstallations(), fetchValidator()])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setBusyVersion(null)
    }
  }, [id, fetchInstallations, fetchValidator])

  // Stage 3 — Network config helpers
  const fetchNetConfig = useCallback(async () => {
    try {
      const res = await fetch(`/api/validators/${id}/config`)

      if (!res.ok) return
      const data = await res.json()
      const c = data.config

      // Per-network public URL defaults from the NetworkPreset table
      // (admin-editable, falls back to empty if preset not loaded yet).
      const net = data.network as string
      const def = netPresets[net] ?? { sponsorSvUrl: '', scanUrl: '', sequencerUrl: '', migrationId: null }

      setNetConfig({
        migrationId: c.migrationId,
        sponsorSvUrl: c.sponsorSvUrl ?? '',
        scanUrl: c.scanUrl ?? '',
        sequencerUrl: c.sequencerUrl ?? '',
        partyHint: c.partyHint ?? '',
        disableBft: c.disableBft ?? true,
        hasOnboardingSecret: !!c.hasOnboardingSecret,
        configuredAt: c.configuredAt,
        firstStartedAt: c.firstStartedAt,
        authEnabled: !!c.authEnabled,
        authUrl: c.authUrl ?? '',
        authJwksUrl: c.authJwksUrl ?? '',
        authWellknownUrl: c.authWellknownUrl ?? '',
        ledgerApiAudience: c.ledgerApiAudience ?? '',
        ledgerApiScope: c.ledgerApiScope ?? '',
        ledgerApiAdminUser: c.ledgerApiAdminUser ?? '',
        validatorAudience: c.validatorAudience ?? '',
        validatorClientId: c.validatorClientId ?? '',
        walletAdminUser: c.walletAdminUser ?? '',
        walletUiClientId: c.walletUiClientId ?? '',
        ansUiClientId: c.ansUiClientId ?? '',
        contactPoint: c.contactPoint ?? '',
        hasValidatorClientSecret: !!c.hasValidatorClientSecret,
        publicAccessMode: (c.publicAccessMode === 'domain' ? 'domain' : 'direct'),
        routingMode: (c.routingMode === 'path' ? 'path' : 'multi'),
        baseDomain: c.baseDomain ?? '',
        enableWallet: c.enableWallet ?? true,
        walletSubdomain: c.walletSubdomain ?? 'wallet',
        enableAns: c.enableAns ?? true,
        ansSubdomain: c.ansSubdomain ?? 'ans',
        enableApi: c.enableApi ?? true,
        apiSubdomain: c.apiSubdomain ?? 'api',
        enableMetrics: !!c.enableMetrics,
        metricsSubdomain: c.metricsSubdomain ?? 'metrics',
        enableGrpcLedger: !!c.enableGrpcLedger,
        grpcLedgerSubdomain: c.grpcLedgerSubdomain ?? 'grpc',
        enableKeycloak: !!c.enableKeycloak,
        keycloakSubdomain: c.keycloakSubdomain ?? 'auth',
        portLedgerApi: c.portLedgerApi ?? 5001,
        portWalletUi: c.portWalletUi ?? 2000,
        portJsonApi: c.portJsonApi ?? 7575,
        portValidatorApi: c.portValidatorApi ?? 5003,
        portSpliceNginx: c.portSpliceNginx ?? 8080,
        walletDomain: c.walletDomain ?? '',
        ansDomain: c.ansDomain ?? '',
        validatorDomain: c.validatorDomain ?? '',
        sslEnabled: !!c.sslEnabled,
        sslEmail: c.sslEmail ?? '',
        sslCertificateId: c.sslCertificateId ?? null,
        nginxDeployedAt: c.nginxDeployedAt ?? null,
        autoTopUpEnabled: !!c.autoTopUpEnabled,
        trafficThroughput: c.trafficThroughput ?? null,
        trafficTopupInterval: c.trafficTopupInterval ?? '1m',
        keycloakEnabled: !!c.keycloakEnabled,
        keycloakPort: c.keycloakPort ?? 8180,
        keycloakRealm: c.keycloakRealm ?? 'canton',
        hasKeycloakAdminPass: !!c.hasKeycloakAdminPass,
        hasKeycloakOperatorPass: !!c.hasKeycloakOperatorPass,
        keycloakDeployedAt: c.keycloakDeployedAt ?? null
      })

      setAuthForm({
        authEnabled: !!c.authEnabled,
        authUrl: c.authUrl ?? '',
        authJwksUrl: c.authJwksUrl ?? '',
        authWellknownUrl: c.authWellknownUrl ?? '',
        ledgerApiAudience: c.ledgerApiAudience ?? '',
        ledgerApiScope: c.ledgerApiScope ?? '',
        ledgerApiAdminUser: c.ledgerApiAdminUser ?? '',
        validatorAudience: c.validatorAudience ?? '',
        validatorClientId: c.validatorClientId ?? '',
        validatorClientSecret: '',
        walletAdminUser: c.walletAdminUser ?? '',
        walletUiClientId: c.walletUiClientId ?? '',
        ansUiClientId: c.ansUiClientId ?? '',
        contactPoint: c.contactPoint ?? ''
      })

      // Infer provider from stored URL
      if (c.authUrl) {
        setAuthProvider(/realms\//i.test(c.authUrl) ? 'keycloak' : 'auth0')
      }

      // Pre-fill form with stored values, falling back to per-network defaults
      // for the URLs (secret stays blank — masked).
      setNetForm({
        migrationId: c.migrationId != null ? String(c.migrationId) : (def.migrationId != null ? String(def.migrationId) : ''),
        sponsorSvUrl: c.sponsorSvUrl ?? def.sponsorSvUrl,
        scanUrl: c.scanUrl ?? def.scanUrl,
        sequencerUrl: c.sequencerUrl ?? def.sequencerUrl,
        onboardingSecret: '',
        partyHint: c.partyHint ?? '',
        disableBft: c.disableBft ?? true,
        autoTopUpEnabled: !!c.autoTopUpEnabled,
        trafficThroughput: c.trafficThroughput != null ? String(c.trafficThroughput) : '200000',
        trafficTopupInterval: c.trafficTopupInterval ?? '1m'
      })

      setPublicForm({
        publicAccessMode: c.publicAccessMode === 'domain' ? 'domain' : 'direct',
        routingMode: c.routingMode === 'path' ? 'path' : 'multi',
        baseDomain: c.baseDomain ?? '',
        enableWallet: c.enableWallet ?? true,
        walletSubdomain: c.walletSubdomain ?? 'wallet',
        enableAns: c.enableAns ?? true,
        ansSubdomain: c.ansSubdomain ?? 'ans',
        enableApi: c.enableApi ?? true,
        apiSubdomain: c.apiSubdomain ?? 'api',
        enableMetrics: !!c.enableMetrics,
        metricsSubdomain: c.metricsSubdomain ?? 'metrics',
        enableGrpcLedger: !!c.enableGrpcLedger,
        grpcLedgerSubdomain: c.grpcLedgerSubdomain ?? 'grpc',
        enableKeycloak: !!c.enableKeycloak,
        keycloakSubdomain: c.keycloakSubdomain ?? 'auth',
        portLedgerApi: c.portLedgerApi ?? 5001,
        portWalletUi: c.portWalletUi ?? 2000,
        portJsonApi: c.portJsonApi ?? 7575,
        portValidatorApi: c.portValidatorApi ?? 5003,
        portSpliceNginx: c.portSpliceNginx ?? 8080,
        sslEnabled: !!c.sslEnabled,
        sslMode: c.sslCertificateId ? 'custom' : 'letsencrypt',
        sslEmail: c.sslEmail ?? '',
        customCertPem: c.sslCertPem ?? '',
        customKeyPem: ''
      })
    } catch {
      // ignore
    }
  }, [id, netPresets])

  useEffect(() => {
    fetchNetConfig()
  }, [fetchNetConfig])

  const saveNetConfig = useCallback(async () => {
    setNetError(null)

    // Client-side validation
    const migrationIdNum = parseInt(netForm.migrationId, 10)

    if (!netForm.migrationId || isNaN(migrationIdNum) || migrationIdNum < 0) {
      setNetError('Migration ID must be a non-negative integer')

      return
    }

    const urlChecks: [string, string][] = [
      ['Sponsor SV URL', netForm.sponsorSvUrl],
      ['Scan URL', netForm.scanUrl],
      ['Sequencer URL', netForm.sequencerUrl]
    ]

    for (const [label, value] of urlChecks) {
      if (!value) {
        setNetError(`${label} is required`)

        return
      }

      try {
        new URL(value)
      } catch {
        setNetError(`${label} must be a valid URL`)

        return
      }
    }

    if (!netForm.partyHint) {
      setNetError('Party hint is required')

      return
    }

    if (!/^[a-zA-Z0-9]+-[a-zA-Z0-9]+-\d+$/.test(netForm.partyHint)) {
      setNetError('Party hint format: <organization>-<function>-<enumerator>, e.g. myCompany-myWallet-1')

      return
    }

    if (!netConfig?.hasOnboardingSecret && !netForm.onboardingSecret) {
      setNetError('Onboarding secret is required')

      return
    }

    setNetSaving(true)

    try {
      const payload: Record<string, unknown> = {
        migrationId: migrationIdNum,
        sponsorSvUrl: netForm.sponsorSvUrl.trim(),
        scanUrl: netForm.scanUrl.trim(),
        sequencerUrl: netForm.sequencerUrl.trim(),
        partyHint: netForm.partyHint.trim(),
        disableBft: netForm.disableBft,
        autoTopUpEnabled: netForm.autoTopUpEnabled,
        trafficThroughput: netForm.trafficThroughput.trim() ? Number(netForm.trafficThroughput) : null,
        trafficTopupInterval: netForm.trafficTopupInterval.trim() || null
      }

      if (netForm.onboardingSecret) payload.onboardingSecret = netForm.onboardingSecret

      const res = await fetch(`/api/validators/${id}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await res.json()

      if (!res.ok) {
        setNetError(data.error ?? 'Failed to save')

        return
      }

      setSuccess('Network configuration saved')
      setNetModalOpen(false)
      await fetchNetConfig()
    } catch (e) {
      setNetError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setNetSaving(false)
    }
  }, [id, netForm, netConfig, fetchNetConfig])

  const saveAuthConfig = useCallback(async () => {
    setAuthError(null)

    // If auth is enabled, validate required URL fields
    if (authForm.authEnabled) {
      const urlChecks: [string, string][] = [
        ['Auth URL', authForm.authUrl],
        ['JWKS URL', authForm.authJwksUrl]
      ]

      for (const [label, value] of urlChecks) {
        if (!value) {
          setAuthError(`${label} is required when auth is enabled`)

          return
        }

        try {
          new URL(value)
        } catch {
          setAuthError(`${label} must be a valid URL`)

          return
        }
      }

      if (!authForm.ledgerApiAudience) {
        setAuthError('Ledger API audience is required')

        return
      }

      if (!authForm.validatorClientId) {
        setAuthError('Validator client ID is required')

        return
      }
    }

    setAuthSaving(true)

    try {
      const payload: Record<string, unknown> = {
        authEnabled: authForm.authEnabled,
        authUrl: authForm.authUrl.trim(),
        authJwksUrl: authForm.authJwksUrl.trim(),
        authWellknownUrl: authForm.authWellknownUrl.trim(),
        ledgerApiAudience: authForm.ledgerApiAudience.trim(),
        ledgerApiScope: authForm.ledgerApiScope.trim(),
        ledgerApiAdminUser: authForm.ledgerApiAdminUser.trim(),
        validatorAudience: authForm.validatorAudience.trim(),
        validatorClientId: authForm.validatorClientId.trim(),
        walletAdminUser: authForm.walletAdminUser.trim(),
        walletUiClientId: authForm.walletUiClientId.trim(),
        ansUiClientId: authForm.ansUiClientId.trim(),
        contactPoint: authForm.contactPoint.trim()
      }

      // Only send client secret when user typed a new one
      if (authForm.validatorClientSecret) {
        payload.validatorClientSecret = authForm.validatorClientSecret
      }

      const res = await fetch(`/api/validators/${id}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await res.json()

      if (!res.ok) {
        setAuthError(data.error ?? 'Failed to save')

        return
      }

      setSuccess('Authentication configuration saved')
      setAuthModalOpen(false)
      await fetchNetConfig()
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setAuthSaving(false)
    }
  }, [id, authForm, fetchNetConfig])

  // Keycloak — deploy container on VPS via SSH + SSE log stream
  const deployKeycloak = useCallback(async (
    port: number,
    realm: string,
    adminUsername: string,
    adminPassword: string,
    operatorUsername: string,
    operatorPassword: string
  ) => {
    setKeycloakModalOpen(false)
    setKeycloakDeploying(true)
    setStartLogs([])
    setStartStatus('running')
    setStartMode('start') // reuse start dialog for log display
    setStartDialogOpen(true)

    try {
      const res = await fetch(`/api/validators/${id}/keycloak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port,
          realm,
          adminUsername,
          adminPassword,
          operatorUsername,
          operatorPassword
        })
      })

      if (!res.body) throw new Error('No stream')

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) break

        buf += dec.decode(value, { stream: true })

        const parts = buf.split('\n\n')

        buf = parts.pop() ?? ''

        for (const part of parts) {
          const line = part.replace(/^data: /, '').trim()

          if (!line) continue

          try {
            const evt = JSON.parse(line) as { message: string; level?: string; ok?: boolean; timestamp?: string }

            if (evt.message === '__DONE__') {
              setStartStatus(evt.ok ? 'success' : 'failed')
              setKeycloakDeploying(false)

              if (evt.ok) {
                await fetchNetConfig()
                setSuccess('Keycloak deployed successfully! Auth Config has been pre-filled.')
              }
            } else {
              setStartLogs(prev => [...prev, {
                timestamp: evt.timestamp ?? new Date().toISOString(),
                level: (evt.level ?? 'info') as StartLog['level'],
                message: evt.message
              }])
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      setStartStatus('failed')
      setStartError(e instanceof Error ? e.message : 'Deploy failed')
      setKeycloakDeploying(false)
    }
  }, [id, fetchNetConfig])

  const removeKeycloak = useCallback(async () => {
    if (!confirm('Stop and remove the Keycloak container from the VPS?')) return

    try {
      await fetch(`/api/validators/${id}/keycloak`, { method: 'DELETE' })
      await fetchNetConfig()
      setSuccess('Keycloak container removed.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Remove failed')
    }

    setKeycloakModalOpen(false)
  }, [id, fetchNetConfig])

  // Stage 5 — Save public access (domain & SSL) config.
  // Pure config save here — actual nginx render + certbot is a separate
  // backend action triggered later.
  const savePublicConfig = useCallback(async () => {
    setPublicError(null)

    if (publicForm.publicAccessMode === 'domain') {
      const hostRe = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i
      const subRe = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i

      if (!publicForm.baseDomain) {
        setPublicError('Base domain is required when Custom Domain is selected')

        return
      }

      if (!hostRe.test(publicForm.baseDomain.trim())) {
        setPublicError('Base domain must be a valid hostname (e.g. node.mynode.com)')

        return
      }

      if (publicForm.routingMode === 'multi') {
        if (!publicForm.enableWallet) {
          setPublicError('Wallet UI must be enabled — required for OIDC callback URL')

          return
        }

        const subChecks: [string, string, boolean][] = [
          ['Wallet subdomain', publicForm.walletSubdomain, publicForm.enableWallet],
          ['ANS subdomain', publicForm.ansSubdomain, publicForm.enableAns],
          ['API subdomain', publicForm.apiSubdomain, publicForm.enableApi],
          ['Metrics subdomain', publicForm.metricsSubdomain, publicForm.enableMetrics],
          ['gRPC subdomain', publicForm.grpcLedgerSubdomain, publicForm.enableGrpcLedger]
        ]

        for (const [label, value, required] of subChecks) {
          if (!required) continue

          if (!value || !subRe.test(value.trim())) {
            setPublicError(`${label} must be a valid DNS label (letters/digits/hyphens, no dots)`)

            return
          }
        }
      }

      if (publicForm.sslEnabled && publicForm.sslMode === 'letsencrypt' && !publicForm.sslEmail) {
        setPublicError('Email is required for Let’s Encrypt SSL issuance')

        return
      }
    }

    setPublicSaving(true)

    try {
      const isDomain = publicForm.publicAccessMode === 'domain'

      const payload: Record<string, unknown> = {
        publicAccessMode: publicForm.publicAccessMode,
        routingMode: publicForm.routingMode,
        baseDomain: isDomain ? publicForm.baseDomain.trim() : '',
        enableWallet: publicForm.enableWallet,
        walletSubdomain: publicForm.walletSubdomain.trim(),
        enableAns: publicForm.enableAns,
        ansSubdomain: publicForm.ansSubdomain.trim(),
        enableApi: publicForm.enableApi,
        apiSubdomain: publicForm.apiSubdomain.trim(),
        enableMetrics: publicForm.enableMetrics,
        metricsSubdomain: publicForm.metricsSubdomain.trim(),
        enableGrpcLedger: publicForm.enableGrpcLedger,
        grpcLedgerSubdomain: publicForm.grpcLedgerSubdomain.trim(),
        enableKeycloak: publicForm.enableKeycloak,
        keycloakSubdomain: publicForm.keycloakSubdomain.trim(),
        portLedgerApi: publicForm.portLedgerApi,
        portWalletUi: publicForm.portWalletUi,
        portJsonApi: publicForm.portJsonApi,
        portValidatorApi: publicForm.portValidatorApi,
        portSpliceNginx: publicForm.portSpliceNginx,
        sslEnabled: isDomain ? publicForm.sslEnabled : false,
        sslMode: publicForm.sslMode,
        sslEmail: isDomain && publicForm.sslMode === 'letsencrypt' ? publicForm.sslEmail.trim() : '',
        customCertPem: isDomain && publicForm.sslMode === 'custom' ? publicForm.customCertPem.trim() : '',
        customKeyPem: isDomain && publicForm.sslMode === 'custom' ? publicForm.customKeyPem.trim() : ''
      }

      const res = await fetch(`/api/validators/${id}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      // Defensive: server may return an empty body on crash / HMR mid-request.
      const raw = await res.text()
      const data = raw ? JSON.parse(raw) : {}

      if (!res.ok) {
        setPublicError(data.error ?? `Save failed (HTTP ${res.status})`)

        return
      }

      setSuccess(
        isDomain
          ? 'Public access configured (domain mode). Deploy nginx from the next step.'
          : 'Public access set to Direct IP mode'
      )
      setPublicModalOpen(false)
      await fetchNetConfig()
    } catch (e) {
      setPublicError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setPublicSaving(false)
    }
  }, [id, publicForm, fetchNetConfig])

  // Compute the FQDN list to verify based on current form (matches the
  // server-side derivation in /api/validators/[id]/configure-domain).
  const dnsFqdns = useMemo(() => {
    if (publicForm.publicAccessMode !== 'domain' || !publicForm.baseDomain) return []
    const base = publicForm.baseDomain.trim()

    if (publicForm.routingMode === 'path') return [base]

    const list: string[] = []

    const add = (sub: string, enabled: boolean) => {
      if (!enabled) return
      const f = sub ? `${sub.trim()}.${base}` : base

      if (!list.includes(f)) list.push(f)
    }

    add(publicForm.walletSubdomain, publicForm.enableWallet)
    add(publicForm.ansSubdomain, publicForm.enableAns)
    add(publicForm.apiSubdomain, publicForm.enableApi)
    add(publicForm.metricsSubdomain, publicForm.enableMetrics)
    add(publicForm.grpcLedgerSubdomain, publicForm.enableGrpcLedger)
    add(publicForm.keycloakSubdomain, publicForm.enableKeycloak)

    return list
  }, [publicForm])

  // Reset DNS results whenever the FQDN list changes.
  useEffect(() => {
    setDnsResults(null)
    setDnsAllOk(false)
    setDnsError(null)
  }, [dnsFqdns])

  const verifyDns = useCallback(async () => {
    if (dnsFqdns.length === 0) return
    setDnsLoading(true)
    setDnsError(null)
    setDnsResults(null)

    try {
      const res = await fetch(`/api/validators/${id}/dns-check?fqdns=${encodeURIComponent(dnsFqdns.join(','))}`)
      const raw = await res.text()
      const data = raw ? JSON.parse(raw) : {}

      if (!res.ok) {
        setDnsError(data.error ?? `HTTP ${res.status}`)
      } else {
        setDnsResults(data.results)
        setDnsExpectedIps(data.expectedIps ?? [])
        setDnsAllOk(!!data.allOk)
      }
    } catch (e) {
      setDnsError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setDnsLoading(false)
    }
  }, [id, dnsFqdns])

  // Apply SSL — open dialog and stream logs from the configure-domain endpoint
  const applySsl = useCallback(async () => {
    setSslError(null)
    setSslLogs([])
    setSslSummary(null)
    setSslStatus('running')
    setSslApplying(true)
    setSslDialogOpen(true)

    try {
      const res = await fetch(`/api/validators/${id}/configure-domain`, { method: 'POST' })

      if (!res.ok || !res.body) {
        const raw = await res.text()
        const data = raw ? (() => { try { return JSON.parse(raw) } catch { return {} } })() : {}

        setSslError(data.error ?? `HTTP ${res.status}`)
        setSslStatus('failed')
        setSslApplying(false)

        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const events = buffer.split('\n\n')

        buffer = events.pop() || ''

        for (const ev of events) {
          if (!ev.startsWith('data: ')) continue
          const json = ev.slice(6)

          try {
            const entry = JSON.parse(json)

            if (entry.message === '__DONE__') {
              setSslApplying(false)

              // Use the structured summary event (preferred). Fall back to
              // "any error level seen" heuristic if the server didn't emit one.
              setSslStatus(prev => {
                if (prev === 'failed') return prev

                return 'success'
              })

              await fetchNetConfig()

              return
            }

            // Structured summary event from server (kind === 'summary')
            if (entry.kind === 'summary') {
              setSslSummary({
                ok: !!entry.ok,
                stage: entry.stage ?? 'unknown',
                probes: entry.probes,
                spliceNginxPort: entry.spliceNginxPort
              })

              if (!entry.ok) setSslStatus('failed')
              continue
            }

            setSslLogs(prev => [...prev, entry])

            if (entry.level === 'error') setSslStatus('failed')
          } catch {
            /* ignore malformed event */
          }
        }
      }

      setSslApplying(false)
    } catch (e) {
      setSslError(e instanceof Error ? e.message : 'Network error')
      setSslStatus('failed')
      setSslApplying(false)
    }
  }, [id, fetchNetConfig])

  // Stage 6 — Start or Stop the validator (start.sh / stop.sh via SSH).
  // Streams the script output via SSE and updates Validator.runState. On
  // success, also reloads the validator row so the card reflects new state.
  const runStartStop = useCallback(async (mode: 'start' | 'stop') => {
    setStartError(null)
    setStartLogs([])
    setStartStatus('running')
    setStartBusy(true)
    setStartMode(mode)
    setStartDialogOpen(true)

    try {
      const res = await fetch(`/api/validators/${id}/${mode}`, { method: 'POST' })

      if (!res.ok || !res.body) {
        const raw = await res.text()
        const data = raw ? (() => { try { return JSON.parse(raw) } catch { return {} } })() : {}

        setStartError(data.error ?? `HTTP ${res.status}`)
        setStartStatus('failed')
        setStartBusy(false)

        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const events = buffer.split('\n\n')

        buffer = events.pop() || ''

        for (const ev of events) {
          if (!ev.startsWith('data: ')) continue
          const json = ev.slice(6)

          try {
            const entry = JSON.parse(json)

            if (entry.message === '__DONE__') {
              setStartBusy(false)
              setStartStatus(prev => prev === 'failed' ? 'failed' : 'success')

              // Refresh validator row so runState chip + buttons update
              try {
                const r = await fetch(`/api/validators/${id}`)

                if (r.ok) {
                  const v = await r.json()

                  setValidator(v)
                }
              } catch { /* ignore */ }

              await fetchNetConfig()

              return
            }

            setStartLogs(prev => [...prev, entry])
            if (entry.level === 'error') setStartStatus('failed')
          } catch {
            /* ignore malformed event */
          }
        }
      }

      setStartBusy(false)
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Network error')
      setStartStatus('failed')
      setStartBusy(false)
    }
  }, [id, fetchNetConfig])

  const handleInstall = async () => {
    setInstalling(true)
    setInstallSteps([])
    setInstallLog('')

    try {
      const res = await fetch(`/api/validators/${id}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: installVersion, customUrl: installCustomUrl || undefined })
      })

      if (!res.ok || !res.body) {
        setError('Install request failed')
        setInstalling(false)

        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n\n')

        buffer = lines.pop() || ''

        for (const line of lines) {
          const data = line.replace('data: ', '').trim()

          if (!data) continue

          try {
            const parsed = JSON.parse(data)

            if (parsed.done) {
              setInstalling(false)
              fetchValidator() // refresh validator info to get new state
              fetchInstallations() // refresh installations list

              return
            }

            if (parsed.log !== undefined) {
              setInstallLog(prev => (prev + parsed.log).slice(-20000))
            } else if (parsed.step) {
              setInstallSteps(prev => {
                const idx = prev.findIndex(s => s.step === parsed.step)

                if (idx >= 0) {
                  const updated = [...prev]

                  updated[idx] = parsed

                  return updated
                }

                return [...prev, parsed]
              })
            }
          } catch {
            // skip
          }
        }
      }
    } catch {
      setError('Install stream failed')
    } finally {
      setInstalling(false)
    }
  }

  const handleSystemCheckCardClick = () => {
    // If we already have results, just open dialog with cached results.
    // User can press "Re-run" inside the dialog to actually run the check again.
    if (systemChecks.length > 0) {
      setCheckDialogOpen(true)

      return
    }

    handleSystemCheck()
  }

  const handleInstallPackage = async (pkg: string) => {
    setInstallingPkg(pkg)

    try {
      const res = await fetch(`/api/validators/${id}/install-package`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: pkg })
      })

      if (!res.ok || !res.body) {
        setError(`Failed to install ${pkg}`)

        return
      }

      // Drain SSE stream until done
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let success = false
      let version = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')

        buffer = lines.pop() || ''

        for (const line of lines) {
          const data = line.replace('data: ', '').trim()

          if (!data) continue

          try {
            const parsed = JSON.parse(data)

            if (parsed.done) {
              success = !!parsed.success
              version = parsed.version || ''
            }
          } catch { /* skip */ }
        }
      }

      if (success) {
        setSuccess(`Installed ${pkg}${version ? ` (${version})` : ''}`)

        // Update the system check row in-place
        setSystemChecks(prev => prev.map(c =>
          c.name === pkg
            ? { ...c, value: version || 'installed', status: 'pass' }
            : c
        ))
      } else {
        setError(`Installation of ${pkg} failed`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to install ${pkg}`)
    } finally {
      setInstallingPkg(null)
    }
  }

  const handleSystemCheck = async () => {
    setCheckDialogOpen(true)
    setCheckingSystem(true)
    setSystemChecks([])
    setCheckHistory([])

    try {
      const res = await fetch(`/api/validators/${id}/system-check`, { method: 'POST' })

      if (!res.ok || !res.body) {
        setError('System check failed')
        setCheckingSystem(false)

        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n\n')

        buffer = lines.pop() || ''

        for (const line of lines) {
          const data = line.replace('data: ', '').trim()

          if (data === '[DONE]') break
          if (!data) continue

          try {
            const check = JSON.parse(data)

            // Append to history for the roller — but skip intermediate
            // "IP Whitelist X/Y" summary updates so the SV node names
            // stay visible in the spotlight. Only push the final summary
            // (status pass/fail/warn, not 'info').
            const isInterimSummary = check.name === 'IP Whitelist' && check.status === 'info'

            if (!isInterimSummary) {
              setCheckHistory(prev => [...prev, check].slice(-15))
            }

            // Accumulate results for final summary
            setSystemChecks(prev => {
              if (check.name === 'IP Whitelist') {
                const idx = prev.findIndex(c => c.name === 'IP Whitelist')

                if (idx >= 0) {
                  const updated = [...prev]

                  updated[idx] = check

                  return updated
                }
              }

              return [...prev, check]
            })
          } catch {
            // skip invalid JSON
          }
        }
      }
    } catch {
      setError('Failed to run system check')
    } finally {
      setCheckingSystem(false)
    }
  }

  // Persist checks to localStorage when they change
  useEffect(() => {
    if (systemChecks.length > 0) {
      localStorage.setItem(`nodepilot-checks-${id}`, JSON.stringify(systemChecks))
    }
  }, [systemChecks, id])

  if (loading) {
    return (
      <div className='flex justify-center items-center min-h-[400px]'>
        <CircularProgress />
      </div>
    )
  }

  if (!validator) {
    return (
      <Alert severity='error'>Validator not found</Alert>
    )
  }

  return (
    <Grid container spacing={6}>
      {/* Header */}
      <Grid size={{ xs: 12 }}>
        <div className='flex items-center gap-3'>
          <IconButton onClick={() => router.push('/validator')}>
            <i className='tabler-arrow-left' />
          </IconButton>
          <div className='flex-1'>
            <div className='flex items-center gap-3'>
              <Typography variant='h4'>{validator.name}</Typography>
              <Chip label={validator.status} size='small' color={statusColor[validator.status] || 'default'} />
              <Chip
                label={validator.deploymentMode === 'k8s' ? 'Kubernetes' : 'Docker Compose'}
                size='small'
                variant='tonal'
                color={validator.deploymentMode === 'k8s' ? 'info' : 'secondary'}
                icon={<i className={validator.deploymentMode === 'k8s' ? 'tabler-ship' : 'tabler-brand-docker'} />}
              />
            </div>
            <Typography variant='body2' color='text.secondary'>
              {validator.host} · {validator.network}
            </Typography>
          </div>
        </div>
      </Grid>

      {error && (
        <Grid size={{ xs: 12 }}>
          <Alert severity='error' onClose={() => setError('')}>{error}</Alert>
        </Grid>
      )}

      {success && (
        <Grid size={{ xs: 12 }}>
          <Alert severity='success' onClose={() => setSuccess('')}>{success}</Alert>
        </Grid>
      )}

      {/* Server Monitor Panel */}
      <Grid size={{ xs: 12 }}>
        <ServerMonitorPanel
          serverStats={serverStats}
          statsError={statsError}
          statsLoading={statsLoading}
          statsHistory={statsHistory}
          deploymentMode={validator.deploymentMode}
          onRefresh={fetchStats}
          onOpenDetail={openStatDetail}
        />
      </Grid>

      {/* Stat Detail Modal */}
      <StatDetailDialog
        state={detailModal}
        onClose={() => setDetailModal(prev => ({ ...prev, open: false }))}
        onRefresh={() => {
          if (detailModal.metric === 'dockerlogs' && detailModal.logContainer) {
            openContainerLogs(detailModal.logContainer)
          } else if (detailModal.metric) {
            openStatDetail(detailModal.metric, detailModal.title, true)
          }
        }}
        onViewLogs={openContainerLogs}
        onBackToContainers={detailModal.metric === 'dockerlogs' ? backToContainers : undefined}
      />

      {/* Action Cards (Stage 1–6) */}
      {validator.deploymentMode === 'k8s' && (
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <K8sConnectionCard
            state={k8sState}
            onClick={() => setK8sDialogOpen(true)}
          />
        </Grid>
      )}

      <Grid size={{ xs: 12, sm: 6, md: 4 }}>
        <SystemCheckCard
          systemChecks={systemChecks}
          onClick={handleSystemCheckCardClick}
          deploymentMode={validator.deploymentMode}
        />
      </Grid>

      <Grid size={{ xs: 12, sm: 6, md: 4 }}>
        {validator.deploymentMode === 'k8s' ? (
          <K8sCantonInstallCard
            state={k8sInstallState}
            gateOpen={k8sState.connected && !!k8sState.namespaceReady}
            onClick={() => setK8sInstallDialogOpen(true)}
          />
        ) : (
          <CantonInstallationCard
            validator={validator}
            installing={installing}
            installations={installations}
            systemChecks={systemChecks}
            k8sReady={k8sState.connected && k8sState.namespaceReady}
            onClick={() => {
              if (!installing) {
                setInstallSteps([])
                setInstallLog('')
                setShowLog(false)
              }

              setInstallModalOpen(true)
              fetchReleases()
              fetchInstallations()
            }}
          />
        )}
      </Grid>

      <Grid size={{ xs: 12, sm: 6, md: 4 }}>
        <NetworkConfigCard
          netConfig={netConfig}
          installations={installations}
          onClick={() => {
            fetchNetConfig()
            setNetError(null)
            setNetModalOpen(true)
          }}
        />
      </Grid>

      <Grid size={{ xs: 12, sm: 6, md: 4 }}>
        <StartStopValidatorCard
          validator={validator}
          netConfig={netConfig}
          startBusy={startBusy}
          onAction={action => runStartStop(action)}
        />
      </Grid>

      <Grid size={{ xs: 12, sm: 6, md: 4 }}>
        {validator.deploymentMode === 'k8s' ? (
          <K8sPublicAccessCard
            exposedPorts={k8sPublicStatus.exposedPorts}
            ingressDomain={k8sPublicStatus.ingressDomain}
            onClick={() => setK8sPublicOpen(true)}
          />
        ) : (
          <PublicAccessCard
            netConfig={netConfig}
            validator={validator}
            onClick={() => {
              setPublicError(null)
              setPublicModalOpen(true)
            }}
          />
        )}
      </Grid>

      <Grid size={{ xs: 12, sm: 6, md: 4 }}>
        <AuthConfigCard
          netConfig={netConfig}
          onClick={() => {
            setAuthError(null)
            setAuthModalOpen(true)
          }}
        />
      </Grid>

      <Grid size={{ xs: 12, sm: 6, md: 4 }}>
        <KeycloakSetupCard
          netConfig={netConfig}
          deploying={keycloakDeploying}
          onClick={() => setKeycloakModalOpen(true)}
        />
      </Grid>

      {/* Stage 3 — Network Config Modal */}
      <NetworkConfigDialog
        open={netModalOpen}
        saving={netSaving}
        error={netError}
        validator={validator}
        config={netConfig}
        form={netForm}
        setForm={setNetForm}
        secretBusy={netSecretBusy}
        onClose={() => setNetModalOpen(false)}
        onSave={saveNetConfig}
        onClearError={() => setNetError(null)}
        onGenerateDevnetSecret={generateDevnetSecret}
      />

      {/* Stage 5 — Public Access Modal (domain & SSL) */}
      <PublicAccessDialog
        open={publicModalOpen}
        saving={publicSaving}
        error={publicError}
        validator={validator}
        config={netConfig}
        form={publicForm}
        setForm={setPublicForm}
        dnsLoading={dnsLoading}
        dnsResults={dnsResults}
        dnsExpectedIps={dnsExpectedIps}
        dnsAllOk={dnsAllOk}
        dnsError={dnsError}
        dnsFqdns={dnsFqdns}
        sslApplying={sslApplying}
        onClose={() => setPublicModalOpen(false)}
        onSave={savePublicConfig}
        onVerifyDns={verifyDns}
        onApplySsl={applySsl}
      />

      {/* Stage 5d — Apply SSL streaming log dialog */}
      <LogStreamDialog
        open={sslDialogOpen}
        busy={sslApplying}
        status={sslStatus}
        title='Apply Public Access (nginx + SSL)'
        iconClass={
          sslStatus === 'failed' ? 'tabler-circle-x text-error' :
          sslStatus === 'success' ? 'tabler-circle-check text-success' :
          'tabler-rocket text-primary'
        }
        logs={sslLogs}
        error={sslError}
        summary={sslSummary}
        onClose={() => setSslDialogOpen(false)}
        onRetry={applySsl}
      />

      {/* Stage 6 — Start / Stop validator streaming log dialog */}
      <LogStreamDialog
        open={startDialogOpen}
        busy={startBusy}
        status={startStatus}
        title={startMode === 'stop' ? 'Stop Validator' : 'Start Validator'}
        iconClass={
          startStatus === 'failed' ? 'tabler-circle-x text-error' :
          startStatus === 'success' ? 'tabler-circle-check text-success' :
          startMode === 'stop' ? 'tabler-player-stop text-warning' :
          'tabler-player-play text-primary'
        }
        logs={startLogs}
        error={startError}
        onClose={() => setStartDialogOpen(false)}
        onRetry={() => runStartStop(startMode)}
      />

      {/* Stage 4 — Auth Configuration Modal */}
      <AuthConfigDialog
        open={authModalOpen}
        saving={authSaving}
        error={authError}
        validator={validator}
        config={netConfig}
        form={authForm}
        setForm={setAuthForm}
        provider={authProvider}
        setProvider={setAuthProvider}
        onClose={() => setAuthModalOpen(false)}
        onSave={saveAuthConfig}
      />

      {/* Keycloak Setup Modal */}
      <KeycloakSetupDialog
        open={keycloakModalOpen}
        deploying={keycloakDeploying}
        validator={validator}
        config={netConfig}
        onClose={() => setKeycloakModalOpen(false)}
        onDeploy={deployKeycloak}
        onRemove={removeKeycloak}
      />

      {/* Install Modal */}
      <InstallVersionDialog
        open={installModalOpen}
        installing={installing}
        installVersion={installVersion}
        installCustomUrl={installCustomUrl}
        installSteps={installSteps}
        installLog={installLog}
        showLog={showLog}
        releases={releases}
        releasesLoading={releasesLoading}
        releasesError={releasesError}
        installations={installations}
        installationsLoading={installationsLoading}
        busyVersion={busyVersion}
        onClose={() => setInstallModalOpen(false)}
        onChangeVersion={setInstallVersion}
        onChangeCustomUrl={setInstallCustomUrl}
        onInstall={handleInstall}
        onFetchReleases={fetchReleases}
        onActivate={activateInstallation}
        onUninstall={uninstallInstallation}
        onToggleLog={() => setShowLog(v => !v)}
      />

      {/* System Check Dialog */}
      <SystemCheckDialog
        open={checkDialogOpen}
        checking={checkingSystem}
        checks={systemChecks}
        history={checkHistory}
        installingPkg={installingPkg}
        onClose={() => setCheckDialogOpen(false)}
        onRerun={handleSystemCheck}
        onInstallPackage={handleInstallPackage}
      />

      {/* K8s Connection Dialog (only mounted in K8s mode) */}
      {validator.deploymentMode === 'k8s' && (
        <K8sConnectionDialog
          open={k8sDialogOpen}
          validator={validator}
          onClose={() => setK8sDialogOpen(false)}
          onStateChange={setK8sState}
        />
      )}

      {/* K8s Canton Install (Helm) Dialog */}
      {validator.deploymentMode === 'k8s' && (
        <K8sCantonInstallDialog
          open={k8sInstallDialogOpen}
          validator={validator}
          onClose={() => setK8sInstallDialogOpen(false)}
          onStateChange={setK8sInstallState}
          networkPreset={netPresets[validator.network] ?? null}
        />
      )}

      {/* K8s Public Access Dialog */}
      {validator.deploymentMode === 'k8s' && (
        <K8sPublicAccessDialog
          open={k8sPublicOpen}
          validator={validator}
          onClose={() => {
            setK8sPublicOpen(false)
            // Refresh card status after dialog closes
            fetch(`/api/validators/${validator.id}/k8s/ingress-status`)
              .then(r => r.json())
              .then(d => setK8sPublicStatus({
                exposedPorts: d.exposedPorts ?? null,
                ingressDomain: d.ingress?.baseDomain ?? null
              }))
              .catch(() => { /* non-fatal */ })
          }}
        />
      )}
    </Grid>
  )
}
