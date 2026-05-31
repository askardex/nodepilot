'use client'

import { useEffect, useState } from 'react'

import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Alert from '@mui/material/Alert'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import LinearProgress from '@mui/material/LinearProgress'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'

import type { Validator } from './types'
import { ActionCard, type ChipStatusColor } from './ActionCard'

export type K8sInstallState = {
  helmReady: boolean
  releaseCount: number
  podsRunning: number
  podsTotal: number
}

export function K8sCantonInstallCard({
  state, gateOpen, onClick
}: {
  state: K8sInstallState
  gateOpen: boolean
  onClick: () => void
}) {
  const installed = state.releaseCount > 0
  const allHealthy = installed && state.podsTotal > 0 && state.podsRunning === state.podsTotal

  const chipLabel: string | undefined = !gateOpen
    ? undefined
    : allHealthy
      ? 'Healthy'
      : installed
        ? `${state.podsRunning}/${state.podsTotal} pods`
        : state.helmReady
          ? 'Helm Ready'
          : undefined

  const chipColor: ChipStatusColor = allHealthy ? 'success' : installed ? 'warning' : 'default'

  return (
    <ActionCard
      icon='tabler-package'
      title='Canton Installation (Helm)'
      caption={state.helmReady ? 'Helm chart deploy · pods · releases' : 'Phase 3 · Helm groundwork'}
      chipLabel={chipLabel}
      chipColor={chipColor}
      accentColor='primary'
      canClick={gateOpen}
      blockedReason={gateOpen ? null : 'Complete K8s Connection first'}
      onClick={onClick}
      extra={state.helmReady ? (
        <Box mt={1}>
          <Typography variant='caption' color='text.secondary' display='block'>
            {state.releaseCount} release(s) · {state.podsRunning}/{state.podsTotal} pods running
          </Typography>
        </Box>
      ) : undefined}
    />
  )
}

// ─── Dialog ────────────────────────────────────────────────────────

type StatusResp = {
  ok: boolean
  namespace?: string
  releases?: Array<{ name: string; chart: string; status: string; revision: string; updated: string }>
  participantDatabaseName?: string | null
  pods?: { running: number; total: number }
  nodes?: { ready: number; total: number }
  error?: string
}

export function K8sCantonInstallDialog({
  open, validator, onClose, onStateChange, networkPreset
}: {
  open: boolean
  validator: Validator
  onClose: () => void
  onStateChange: (next: K8sInstallState) => void
  networkPreset?: { sponsorSvUrl: string; scanUrl: string; sequencerUrl: string; migrationId: number | null } | null
}) {
  const [status, setStatus] = useState<StatusResp | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── postgres form ──────────────────────────────────────────────────
  const [pgStorageClass, setPgStorageClass] = useState('local-path')
  const [pgVolumeSize, setPgVolumeSize] = useState('50Gi')
  const [pgVersion, setPgVersion] = useState('')
  const [pgBusy, setPgBusy] = useState(false)
  const [pgLog, setPgLog] = useState('')
  const [pgDone, setPgDone] = useState(false)
  const [versions, setVersions] = useState<string[]>([])

  // ── participant form ───────────────────────────────────────────────
  // pgReleaseName = Helm release name of postgres (determines K8s service name).
  // Auto-populated from status releases; user can override if postgres was installed
  // with a custom release name.
  const [pgReleaseName, setPgReleaseName] = useState('splice-postgres')
  const [partMigrationId, setPartMigrationId] = useState('0')
  const [partDisableAuth, setPartDisableAuth] = useState(true)
  const [partOidcUrl, setPartOidcUrl] = useState('')
  const [partOidcAudience, setPartOidcAudience] = useState('')
  const [partBusy, setPartBusy] = useState(false)
  const [partLog, setPartLog] = useState('')
  const [partDone, setPartDone] = useState(false)
  const [partPods, setPartPods] = useState<Array<{ name: string; ready: string; phase: string; reason: string }>>([])
  const [partReduceResources, setPartReduceResources] = useState(true)

  // ── validator form ─────────────────────────────────────────────────
  const [valSponsorSvUrl, setValSponsorSvUrl] = useState('')
  const [valOnboardingSecret, setValOnboardingSecret] = useState('')
  const [valPartyHint, setValPartyHint] = useState('')
  const [valContactPoint, setValContactPoint] = useState('')
  const [valScanUrl, setValScanUrl] = useState('')
  const [valSequencerUrl, setValSequencerUrl] = useState('')
  const [valWalletUserId, setValWalletUserId] = useState('')

  // valDisableAuth mirrors partDisableAuth — used when validator OIDC is decoupled from participant in future
  // const [valDisableAuth, setValDisableAuth] = useState(true)

  const [valOidcUrl, setValOidcUrl] = useState('')
  const [valOidcAudience, setValOidcAudience] = useState('')
  const [valReduceResources, setValReduceResources] = useState(true)
  const [valBusy, setValBusy] = useState(false)
  const [valSecretBusy, setValSecretBusy] = useState(false)
  const [valLog, setValLog] = useState('')
  const [valDone, setValDone] = useState(false)
  const [valPods, setValPods] = useState<Array<{ name: string; ready: string; phase: string; reason: string }>>([])

  // ── install progress tracking ──────────────────────────────────
  const [pgPods, setPgPods] = useState<Array<{ name: string; ready: string; phase: string; reason: string }>>([])
  const [pgCurrentStep, setPgCurrentStep] = useState('')
  const [partCurrentStep, setPartCurrentStep] = useState('')
  const [valCurrentStep, setValCurrentStep] = useState('')
  const [pgElapsed, setPgElapsed] = useState(0)
  const [partElapsed, setPartElapsed] = useState(0)
  const [valElapsed, setValElapsed] = useState(0)

  // ── expose services ───────────────────────────────────────────────
  const [exposeBusy, setExposeBusy] = useState(false)
  const [exposedPorts, setExposedPorts] = useState<{ wallet: number; ans: number; validatorApi: number } | null>(null)
  const [exposeError, setExposeError] = useState<string | null>(null)

  // ── keycloak (OIDC) ───────────────────────────────────────────────
  const [kcRealm, setKcRealm] = useState('canton')
  const [kcBaseDomain, setKcBaseDomain] = useState('')
  const [kcBusy, setKcBusy] = useState(false)
  const [kcLog, setKcLog] = useState('')
  const [kcDeployed, setKcDeployed] = useState(false)
  const [kcIssuerUrl, setKcIssuerUrl] = useState('')
  const [kcDnsLoading, setKcDnsLoading] = useState(false)
  const [kcDnsResult, setKcDnsResult] = useState<{ ok: boolean; a: string[]; cfProxied?: boolean; error?: string } | null>(null)

  const exposeServices = async () => {
    setExposeBusy(true)
    setExposeError(null)

    try {
      const res = await fetch(`/api/validators/${validator.id}/k8s/expose-services`, { method: 'POST' })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)

      setExposedPorts(data.ports)
    } catch (err: any) {
      setExposeError(err?.message || 'Failed to expose services')
    } finally {
      setExposeBusy(false)
    }
  }

  const generateDevnetSecret = async () => {
    if (!valSponsorSvUrl) return
    setValSecretBusy(true)

    try {
      const res = await fetch(`/api/validators/${validator.id}/config/devnet-secret`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sponsorSvUrl: valSponsorSvUrl })
      })

      const data = await res.json()

      if (!res.ok) {
        const msg = data.hint ? `${data.error || `HTTP ${res.status}`} — ${data.hint}` : (data.error || `HTTP ${res.status}`)

        throw new Error(msg)
      }

      setValOnboardingSecret(data.secret)
    } catch (err: any) {
      setValLog(prev => prev + `\n[ERROR] Get secret: ${err?.message || 'unknown'}\n`)
    } finally {
      setValSecretBusy(false)
    }
  }

  const verifyKcDns = async () => {
    if (!kcBaseDomain) return

    const fqdn = `auth.${kcBaseDomain}`

    setKcDnsLoading(true)
    setKcDnsResult(null)

    try {
      const res = await fetch(`/api/validators/${validator.id}/dns-check?fqdns=${encodeURIComponent(fqdn)}`)
      const data = await res.json()

      if (!res.ok) {
        setKcDnsResult({ ok: false, a: [], error: data.error || `HTTP ${res.status}` })
      } else {
        const r = data.results?.[0]

        setKcDnsResult(r ? { ok: r.ok, a: r.a ?? [], cfProxied: r.cfProxied, error: r.error } : { ok: false, a: [], error: 'No result' })
      }
    } catch (e: any) {
      setKcDnsResult({ ok: false, a: [], error: e?.message || 'Network error' })
    } finally {
      setKcDnsLoading(false)
    }
  }

  const deployKeycloak = async () => {
    setKcBusy(true)
    setKcLog('')

    try {
      const res = await fetch(`/api/validators/${validator.id}/k8s/deploy-keycloak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          realm: kcRealm,
          baseDomain: kcBaseDomain,
          keycloakSubdomain: 'auth'
        })
      })

      if (!res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) break
        buf += decoder.decode(value, { stream: true })

        const events = buf.split('\n\n')

        buf = events.pop() ?? ''

        for (const ev of events) {
          const line = ev.split('\n').find(l => l.startsWith('data: '))

          if (!line) continue

          try {
            const parsed = JSON.parse(line.slice(6))

            if ('message' in parsed && parsed.message === '__DONE__') {
              if (parsed.ok) {
                setKcDeployed(true)

                // Derive issuer URL for display
                const base = kcBaseDomain ? `https://auth.${kcBaseDomain}` : `http://${validator.host}:30180`

                setKcIssuerUrl(`${base}/realms/${kcRealm}`)

                // Pre-fill OIDC fields so user can re-install participant/validator with auth
                setPartOidcUrl(`${base}/realms/${kcRealm}`)
                setPartOidcAudience(`${base}/realms/${kcRealm}`)
                setValOidcUrl(`${base}/realms/${kcRealm}`)
                setValOidcAudience(`${base}/realms/${kcRealm}`)
              }
            } else if ('message' in parsed) {
              setKcLog(prev => (prev + parsed.message + '\n').slice(-4000))
            }
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      setKcLog(prev => prev + `\n[ERROR] ${e instanceof Error ? e.message : String(e)}\n`)
    } finally {
      setKcBusy(false)
    }
  }

  const removeKeycloak = async () => {
    if (!confirm('Remove Keycloak Deployment from k3s? Realm + clients will be lost.')) return

    try {
      await fetch(`/api/validators/${validator.id}/k8s/deploy-keycloak`, { method: 'DELETE' })

      setKcDeployed(false)
      setKcIssuerUrl('')
      setKcLog('')
    } catch (e) {
      setKcLog(`Remove failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const refreshStatus = async () => {
    try {
      const res = await fetch(`/api/validators/${validator.id}/k8s/helm-status`)
      const data: StatusResp = await res.json()

      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)

      setStatus(data)

      // Auto-detect postgres release name from deployed releases
      const pgRel = data.releases?.find(r => r.name.includes('postgres'))

      if (pgRel) setPgReleaseName(pgRel.name)

      // Auto-populate migrationId from existing participant databaseName (e.g. 'participant_1' → '1')
      if (data.participantDatabaseName) {
        const match = data.participantDatabaseName.match(/_(\d+)$/)

        if (match) setPartMigrationId(match[1])
      }

      onStateChange({
        helmReady: true,
        releaseCount: data.releases?.length ?? 0,
        podsRunning: data.pods?.running ?? 0,
        podsTotal: data.pods?.total ?? 0
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    if (!open) return
    refreshStatus()

    // When auth is disabled (DevNet/TestNet), default wallet user is the Canton built-in admin
    if (partDisableAuth && !valWalletUserId) setValWalletUserId('administrator')

    // Auto-fill from network preset (DevNet/TestNet/MainNet defaults)
    if (networkPreset) {
      if (networkPreset.sponsorSvUrl) setValSponsorSvUrl(networkPreset.sponsorSvUrl)

      if (networkPreset.scanUrl) {
        setValScanUrl(networkPreset.scanUrl)
      }

      if (networkPreset.sequencerUrl) setValSequencerUrl(networkPreset.sequencerUrl)

      if (networkPreset.migrationId !== null && networkPreset.migrationId !== undefined) {
        setPartMigrationId(String(networkPreset.migrationId))
      }
    }

    fetch('/api/canton/versions')
      .then(r => r.json())
      .then(d => {
        const list: string[] = Array.isArray(d?.versions) ? d.versions.slice(0, 4) : []

        setVersions(list)
        setPgVersion(v => v || list[0] || '')
      })
      .catch(() => {})

    // Check if Keycloak is already deployed
    fetch(`/api/validators/${validator.id}/k8s/ingress-status`)
      .then(r => r.json())
      .then(d => {
        if (d.ingress?.baseDomain) setKcBaseDomain(prev => prev || d.ingress.baseDomain)
      })
      .catch(() => {})

    // Prefill Wallet Operator User ID from Keycloak Setup (validatorConfig.walletAdminUser).
    // This is the operator username in the realm — Splice will match it against
    // the JWT `sub` claim (Keycloak mapper sets sub = username on wallet-ui/ans-ui).
    fetch(`/api/validators/${validator.id}/config`)
      .then(r => r.json())
      .then(d => {
        const u = (d?.config?.walletAdminUser ?? '').trim()

        if (u) setValWalletUserId(prev => prev || u)
      })
      .catch(() => {})

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Elapsed time tickers (auto-reset when busy goes false)
  useEffect(() => {
    if (!pgBusy) {
      setPgElapsed(0)

      return
    }

    const t = setInterval(() => setPgElapsed(s => s + 1), 1000)

    return () => clearInterval(t)
  }, [pgBusy])

  useEffect(() => {
    if (!partBusy) {
      setPartElapsed(0)

      return
    }

    const t = setInterval(() => setPartElapsed(s => s + 1), 1000)

    return () => clearInterval(t)
  }, [partBusy])

  useEffect(() => {
    if (!valBusy) {
      setValElapsed(0)

      return
    }

    const t = setInterval(() => setValElapsed(s => s + 1), 1000)

    return () => clearInterval(t)
  }, [valBusy])

  const fmtElapsed = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60

    return m > 0 ? `${m}m ${sec}s` : `${sec}s`
  }

  const installPostgres = async () => {
    setPgBusy(true)
    setPgLog('')
    setPgDone(false)
    setPgPods([])
    setPgCurrentStep('')
    setError(null)

    const valuesYaml = [
      'db:',
      `  volumeStorageClass: ${pgStorageClass}`,
      `  volumeSize: ${pgVolumeSize}`,
    ].join('\n')

    try {
      // Step 0: Create postgres-secrets (required before postgres pod starts)
      const secretRes = await fetch(`/api/validators/${validator.id}/k8s/create-secret`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'postgres-secrets',
          entries: { postgresPassword: crypto.randomUUID().replace(/-/g, '') },
        })
      })

      if (!secretRes.ok) {
        const d = await secretRes.json().catch(() => ({}))

        // 409 = already exists — that's fine
        if (secretRes.status !== 409) {
          throw new Error(d.error || `Failed to create postgres-secrets: HTTP ${secretRes.status}`)
        }
      }

      setPgLog(prev => prev + '[OK] postgres-secrets ready\n')

      const res = await fetch(`/api/validators/${validator.id}/k8s/helm-install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          releaseName: 'splice-postgres',
          chartRef: 'oci://ghcr.io/digital-asset/decentralized-canton-sync/helm/splice-postgres',
          version: pgVersion || undefined,
          valuesYaml,
        })
      })

      if (!res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) break
        buf += decoder.decode(value, { stream: true })

        const events = buf.split('\n\n')

        buf = events.pop() ?? ''

        for (const ev of events) {
          const line = ev.split('\n').find(l => l.startsWith('data: '))

          if (!line) continue

          try {
            const parsed = JSON.parse(line.slice(6))

            if ('log' in parsed) {
              setPgLog(prev => (prev + parsed.log).slice(-4000))
            } else if ('pods' in parsed && Array.isArray(parsed.pods)) {
              setPgPods(parsed.pods as Array<{ name: string; ready: string; phase: string; reason: string }>)
            } else if ('step' in parsed) {
              if (parsed.status === 'running') setPgCurrentStep(parsed.step)
              else setPgCurrentStep('')
              setPgLog(prev => (prev + `[${parsed.status}] ${parsed.step}${parsed.message ? ' — ' + parsed.message : ''}\n`).slice(-4000))
            } else if ('done' in parsed) {
              setPgCurrentStep('')
              if (parsed.error) setError(parsed.error)
              else setPgDone(true)
            }
          } catch { /* ignore */ }
        }
      }

      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPgBusy(false)
    }
  }

  const installParticipant = async () => {
    setPartBusy(true)
    setPartLog('')
    setPartDone(false)
    setPartPods([])
    setError(null)

    try {
      const res = await fetch(`/api/validators/${validator.id}/k8s/helm-install-participant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: pgVersion,
          migrationId: Number(partMigrationId),
          disableAuth: partDisableAuth,
          oidcAuthorityUrl: partOidcUrl,
          oidcLedgerApiAudience: partOidcAudience,
          reduceResources: partReduceResources,
          postgresReleaseName: pgReleaseName,
        })
      })

      if (!res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) break
        buf += decoder.decode(value, { stream: true })

        const events = buf.split('\n\n')

        buf = events.pop() ?? ''

        for (const ev of events) {
          const line = ev.split('\n').find(l => l.startsWith('data: '))

          if (!line) continue

          try {
            const parsed = JSON.parse(line.slice(6))

            if ('log' in parsed) {
              setPartLog(prev => (prev + parsed.log).slice(-4000))
            } else if ('pods' in parsed && Array.isArray(parsed.pods)) {
              setPartPods(parsed.pods as Array<{ name: string; ready: string; phase: string; reason: string }>)
            } else if ('step' in parsed) {
              if (parsed.status === 'running') setPartCurrentStep(parsed.step)
              else setPartCurrentStep('')
              setPartLog(prev => (prev + `[${parsed.status}] ${parsed.step}${parsed.message ? ' — ' + parsed.message : ''}\n`).slice(-4000))
            } else if ('done' in parsed) {
              setPartCurrentStep('')
              if (parsed.error) setError(parsed.error)
              else setPartDone(true)
            }
          } catch { /* ignore */ }
        }
      }

      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPartBusy(false)
    }
  }

  const diagnoseParticipant = async () => {
    setPartLog('')

    try {
      const r = await fetch(`/api/validators/${validator.id}/k8s/helm-diagnose?releaseName=participant`)
      const d = await r.json()

      setPartLog('========== DIAGNOSE ==========\n' + (d.output || d.error || 'no output'))
    } catch (e) {
      setPartLog('diagnose failed: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const installValidator = async () => {
    setValBusy(true)
    setValLog('')
    setValDone(false)
    setValPods([])
    setError(null)

    try {
      const res = await fetch(`/api/validators/${validator.id}/k8s/helm-install-validator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: pgVersion,
          migrationId: Number(partMigrationId),
          sponsorSvUrl: valSponsorSvUrl,
          onboardingSecret: valOnboardingSecret,
          validatorPartyHint: valPartyHint,
          contactPoint: valContactPoint,
          scanUrl: valScanUrl,
          sequencerUrl: valSequencerUrl,
          disableAuth: partDisableAuth,
          oidcAuthorityUrl: valOidcUrl,
          oidcAudience: valOidcAudience,
          reduceResources: valReduceResources,
          pgReleaseName: pgReleaseName,
          walletUserId: valWalletUserId,
        })
      })

      if (!res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) break
        buf += decoder.decode(value, { stream: true })

        const events = buf.split('\n\n')

        buf = events.pop() ?? ''

        for (const ev of events) {
          const line = ev.split('\n').find(l => l.startsWith('data: '))

          if (!line) continue

          try {
            const parsed = JSON.parse(line.slice(6))

            if ('log' in parsed) {
              setValLog(prev => (prev + parsed.log).slice(-4000))
            } else if ('pods' in parsed && Array.isArray(parsed.pods)) {
              setValPods(parsed.pods as Array<{ name: string; ready: string; phase: string; reason: string }>)
            } else if ('step' in parsed) {
              if (parsed.status === 'running') setValCurrentStep(parsed.step)
              else setValCurrentStep('')
              setValLog(prev => (prev + `[${parsed.status}] ${parsed.step}${parsed.message ? ' — ' + parsed.message : ''}\n`).slice(-4000))
            } else if ('done' in parsed) {
              setValCurrentStep('')
              if (parsed.error) setError(parsed.error)
              else setValDone(true)
            }
          } catch { /* ignore */ }
        }
      }

      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setValBusy(false)
    }
  }

  const diagnoseValidator = async () => {
    setValLog('')

    try {
      const r = await fetch(`/api/validators/${validator.id}/k8s/helm-diagnose?releaseName=validator`)
      const d = await r.json()

      setValLog('========== DIAGNOSE ==========\n' + (d.output || d.error || 'no output'))
    } catch (e) {
      setValLog('diagnose failed: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const postgresRelease = status?.releases?.find(r => r.name === 'splice-postgres')
  const participantRelease = status?.releases?.find(r => r.name === 'participant')
  const validatorRelease = status?.releases?.find(r => r.name === 'validator')

  return (
    <Dialog open={open} onClose={onClose} maxWidth='md' fullWidth>
      <DialogTitle>Canton Installation (Helm)</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3} sx={{ pt: 1 }}>

          {/* ── 1. splice-postgres ─────────────────────────────────── */}
          <Box>
            <Stack direction='row' alignItems='center' spacing={1} mb={1.5}>
              <Chip label='1' size='small' color='primary' />
              <Typography variant='subtitle1' fontWeight='bold'>splice-postgres</Typography>
              {postgresRelease && (
                <Chip
                  size='small'
                  label={postgresRelease.status}
                  color={postgresRelease.status === 'deployed' ? 'success' : 'warning'}
                />
              )}
            </Stack>

            <Stack spacing={2}>
              <Stack direction='row' spacing={2}>
                <TextField
                  label='db.volumeStorageClass'
                  select
                  size='small'
                  sx={{ flex: 1 }}
                  value={pgStorageClass}
                  onChange={e => setPgStorageClass(e.target.value)}
                  disabled={pgBusy}
                  helperText='k3s → local-path · GKE → standard-rwo'
                >
                  <MenuItem value='local-path'>local-path (k3s / bare-metal)</MenuItem>
                  <MenuItem value='standard-rwo'>standard-rwo (GKE)</MenuItem>
                  <MenuItem value='gp2'>gp2 (AWS EKS)</MenuItem>
                  <MenuItem value='managed-premium'>managed-premium (AKS)</MenuItem>
                </TextField>

                <TextField
                  label='db.volumeSize'
                  size='small'
                  sx={{ width: 120 }}
                  value={pgVolumeSize}
                  onChange={e => setPgVolumeSize(e.target.value)}
                  disabled={pgBusy}
                  helperText='e.g. 50Gi'
                />

                <TextField
                  label='Version'
                  select
                  size='small'
                  sx={{ width: 150 }}
                  value={pgVersion}
                  onChange={e => setPgVersion(e.target.value)}
                  disabled={pgBusy}
                  helperText='4 latest releases (from GitHub)'
                >
                  {versions.map((v, i) => (
                    <MenuItem key={v} value={v}>
                      {v}{i === 0 ? ' (latest)' : ''}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>

              <Box
                component='pre'
                sx={{
                  bgcolor: 'action.hover',
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  p: 1.5,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  m: 0,
                }}
              >
                {`db:\n  volumeStorageClass: ${pgStorageClass}\n  volumeSize: ${pgVolumeSize}`}
              </Box>

              <Stack direction='row' justifyContent='flex-end'>
                <Button
                  variant='contained'
                  disabled={pgBusy}
                  onClick={installPostgres}
                >
                  {pgBusy ? 'Installing…' : postgresRelease ? 'Upgrade' : 'Install'}
                </Button>
              </Stack>

              {pgBusy && (
                <Box>
                  <Stack direction='row' alignItems='center' spacing={1} mb={0.5}>
                    <CircularProgress size={14} />
                    <Typography variant='body2' fontWeight={600} sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {pgCurrentStep || 'Preparing…'}
                    </Typography>
                    <Typography variant='caption' color='text.secondary' sx={{ ml: 'auto !important' }}>
                      {fmtElapsed(pgElapsed)}
                    </Typography>
                  </Stack>
                  <LinearProgress />
                </Box>
              )}

              {pgBusy && pgPods.length > 0 && (
                <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                  <Table size='small'>
                    <TableHead>
                      <TableRow>
                        <TableCell>Pod</TableCell>
                        <TableCell>Ready</TableCell>
                        <TableCell>Phase</TableCell>
                        <TableCell>Reason</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {pgPods.map(p => (
                        <TableRow key={p.name}>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{p.name}</TableCell>
                          <TableCell sx={{ fontSize: 12 }}>{p.ready}</TableCell>
                          <TableCell>
                            <Chip
                              size='small'
                              label={p.phase}
                              color={p.phase === 'Running' ? 'success' : p.phase === 'Pending' ? 'warning' : 'default'}
                            />
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>{p.reason}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}

              {pgDone && !pgBusy && (
                <Alert severity='success'>splice-postgres installed successfully.</Alert>
              )}

              {pgLog && (
                <Box
                  component='pre'
                  sx={{
                    bgcolor: 'background.default',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    p: 1.5,
                    fontSize: 11,
                    maxHeight: 180,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    m: 0,
                  }}
                >
                  {pgLog}
                </Box>
              )}
            </Stack>
          </Box>

          <Divider />

          {/* ── 2. splice-participant ──────────────────────────────── */}
          <Box>
            <Stack direction='row' alignItems='center' spacing={1} mb={1.5}>
              <Chip label='2' size='small' color='primary' />
              <Typography variant='subtitle1' fontWeight='bold'>splice-participant</Typography>
              {participantRelease && (
                <Chip
                  size='small'
                  label={participantRelease.status}
                  color={participantRelease.status === 'deployed' ? 'success' : 'warning'}
                />
              )}
            </Stack>

            <Stack spacing={2}>
              <Stack direction='row' spacing={2} alignItems='flex-start' flexWrap='wrap'>
                <TextField
                  label='Postgres Release Name'
                  size='small'
                  sx={{ width: 200 }}
                  value={pgReleaseName}
                  onChange={e => setPgReleaseName(e.target.value.trim())}
                  disabled={partBusy}
                  helperText='Helm release name of postgres (auto-detected)'
                  error={!pgReleaseName}
                />
                <TextField
                  label='MIGRATION_ID'
                  size='small'
                  sx={{ width: 140 }}
                  value={partMigrationId}
                  onChange={e => setPartMigrationId(e.target.value.replace(/\D/g, ''))}
                  disabled={partBusy}
                  helperText='synchronizer migration ID'
                  inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }}
                />

                <TextField
                  label='Auth'
                  select
                  size='small'
                  sx={{ width: 180 }}
                  value={partDisableAuth ? 'disabled' : 'enabled'}
                  onChange={e => setPartDisableAuth(e.target.value === 'disabled')}
                  disabled={partBusy}
                  helperText='DevNet → disabled'
                >
                  <MenuItem value='disabled'>Disabled (no OIDC)</MenuItem>
                  <MenuItem value='enabled'>Enabled (OIDC)</MenuItem>
                </TextField>

                <TextField
                  label='Resources'
                  select
                  size='small'
                  sx={{ width: 200 }}
                  value={partReduceResources ? 'reduced' : 'default'}
                  onChange={e => setPartReduceResources(e.target.value === 'reduced')}
                  disabled={partBusy}
                  helperText='k3s/small node → reduced'
                >
                  <MenuItem value='reduced'>Reduced (k3s / small node)</MenuItem>
                  <MenuItem value='default'>Default (chart values)</MenuItem>
                </TextField>
              </Stack>

              {!partDisableAuth && (
                <Stack spacing={2}>
                  <TextField
                    label='OIDC_AUTHORITY_URL'
                    size='small'
                    fullWidth
                    value={partOidcUrl}
                    onChange={e => setPartOidcUrl(e.target.value)}
                    disabled={partBusy}
                    placeholder='https://your-keycloak/realms/canton'
                  />
                  <TextField
                    label='OIDC_AUTHORITY_LEDGER_API_AUDIENCE'
                    size='small'
                    fullWidth
                    value={partOidcAudience}
                    onChange={e => setPartOidcAudience(e.target.value)}
                    disabled={partBusy}
                    placeholder='https://canton.network.global'
                  />
                </Stack>
              )}

              <Stack direction='row' justifyContent='flex-end' spacing={1}>
                <Button
                  variant='outlined'
                  size='small'
                  onClick={diagnoseParticipant}
                  disabled={partBusy}
                >
                  Diagnose
                </Button>
                <Button
                  variant='contained'
                  disabled={partBusy || !postgresRelease}
                  onClick={installParticipant}
                  title={!postgresRelease ? 'Install splice-postgres first' : ''}
                >
                  {partBusy ? 'Installing…' : participantRelease ? 'Upgrade' : 'Install'}
                </Button>
              </Stack>

              {!postgresRelease && (
                <Alert severity='warning' sx={{ py: 0.5 }}>Install splice-postgres first.</Alert>
              )}

              {partBusy && (
                <Box>
                  <Stack direction='row' alignItems='center' spacing={1} mb={0.5}>
                    <CircularProgress size={14} />
                    <Typography variant='body2' fontWeight={600} sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {partCurrentStep || 'Preparing…'}
                    </Typography>
                    <Typography variant='caption' color='text.secondary' sx={{ ml: 'auto !important' }}>
                      {fmtElapsed(partElapsed)}
                    </Typography>
                  </Stack>
                  <LinearProgress />
                </Box>
              )}

              {partBusy && partPods.length > 0 && (
                <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                  <Table size='small'>
                    <TableHead>
                      <TableRow>
                        <TableCell>Pod</TableCell>
                        <TableCell>Ready</TableCell>
                        <TableCell>Phase</TableCell>
                        <TableCell>Reason</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {partPods.map(p => (
                        <TableRow key={p.name}>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{p.name}</TableCell>
                          <TableCell sx={{ fontSize: 12 }}>{p.ready}</TableCell>
                          <TableCell>
                            <Chip
                              size='small'
                              label={p.phase}
                              color={p.phase === 'Running' ? 'success' : p.phase === 'Pending' ? 'warning' : 'default'}
                            />
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>{p.reason}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}

              {partBusy && partPods.some(p => p.phase === 'Pending') && (
                <Alert
                  severity='warning'
                  action={
                    <Button size='small' color='inherit' onClick={diagnoseParticipant}>
                      Diagnose
                    </Button>
                  }
                >
                  Pod stuck in Pending — click Diagnose to see the cause (resources / secrets / node taints).
                </Alert>
              )}

              {partDone && !partBusy && (
                <Alert severity='success'>splice-participant installed successfully.</Alert>
              )}

              {partLog && (
                <Box
                  component='pre'
                  sx={{
                    bgcolor: 'background.default',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    p: 1.5,
                    fontSize: 11,
                    maxHeight: 180,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    m: 0,
                  }}
                >
                  {partLog}
                </Box>
              )}
            </Stack>
          </Box>

          <Divider />

          {/* ── 3. splice-validator ────────────────────────────────── */}
          <Box>
            <Stack direction='row' alignItems='center' spacing={1} mb={1.5}>
              <Chip label='3' size='small' color='primary' />
              <Typography variant='subtitle1' fontWeight='bold'>splice-validator</Typography>
              {validatorRelease && (
                <Chip
                  size='small'
                  label={validatorRelease.status}
                  color={validatorRelease.status === 'deployed' ? 'success' : 'warning'}
                />
              )}
            </Stack>

            <Stack spacing={2}>
              {/* Row 1: Sponsor SV URL */}
              <TextField
                label='Sponsor SV URL'
                size='small'
                fullWidth
                value={valSponsorSvUrl}
                onChange={e => setValSponsorSvUrl(e.target.value.trim())}
                disabled={valBusy}
                placeholder='https://sv.sv-2.global.dev.canton.network.digitalasset.com'
                helperText='URL of the SV that issued your onboarding secret'
              />

              {/* Row 2: Onboarding Secret */}
              <div>
                <TextField
                  label='Onboarding Secret'
                  size='small'
                  fullWidth
                  value={valOnboardingSecret}
                  onChange={e => setValOnboardingSecret(e.target.value.trim())}
                  disabled={valBusy || valSecretBusy}
                  type='password'
                  placeholder={validatorRelease ? '(leave empty to keep existing)' : 'one-time secret from sponsor SV'}
                  helperText={validatorRelease
                    ? 'Optional for upgrade — existing secret in K8s cluster will be used'
                    : 'Will be stored as K8s secret splice-app-validator-onboarding-validator'}
                />
                {validator.network === 'DevNet' && (
                  <Button
                    size='small'
                    variant='text'
                    onClick={generateDevnetSecret}
                    disabled={valBusy || valSecretBusy || !valSponsorSvUrl}
                    startIcon={valSecretBusy ? <CircularProgress size={12} /> : <i className='tabler-bolt text-sm' />}
                    sx={{ textTransform: 'none', mt: 0.5 }}
                  >
                    {valSecretBusy ? 'Requesting…' : 'Generate from sponsor SV'}
                  </Button>
                )}
              </div>

              {/* Row 3: Scan URL + Sequencer URL */}
              <TextField
                label='Trusted Scan URL'
                size='small'
                fullWidth
                value={valScanUrl}
                onChange={e => setValScanUrl(e.target.value.trim())}
                disabled={valBusy}
                placeholder='https://scan.sv-2.global.dev.canton.network.digitalasset.com'
                helperText='Scan API URL from a trusted SV (trust-single mode)'
              />

              <TextField
                label='Sequencer URL'
                size='small'
                fullWidth
                value={valSequencerUrl}
                onChange={e => setValSequencerUrl(e.target.value.trim())}
                disabled={valBusy}
                placeholder='https://sequencer.sv-2.global.dev.canton.network.digitalasset.com'
                helperText='Sequencer URL for connecting to the synchronizer'
              />

              {/* Row 4: Party Hint + Contact Point */}
              <Stack direction='row' spacing={2}>
                <TextField
                  label='Validator Party Hint'
                  size='small'
                  sx={{ flex: 1 }}
                  value={valPartyHint}
                  onChange={e => setValPartyHint(e.target.value.trim())}
                  disabled={valBusy}
                  placeholder={validatorRelease ? '(leave empty to keep existing)' : 'myvalidator-1'}
                  helperText={validatorRelease
                    ? 'Optional for upgrade — existing hint will be used'
                    : 'Validator operator party ID prefix (e.g. myvalidator-1::...)'}
                />
                <TextField
                  label='Contact Point'
                  size='small'
                  sx={{ flex: 1 }}
                  value={valContactPoint}
                  onChange={e => setValContactPoint(e.target.value.trim())}
                  disabled={valBusy}
                  placeholder='admin@example.com'
                  helperText='Contact email/URL visible to network operators'
                />
              </Stack>

              {/* Row 4b: Wallet Operator User ID */}
              <TextField
                label='Wallet Operator User ID'
                size='small'
                fullWidth
                required={!partDisableAuth}
                value={valWalletUserId}
                onChange={e => setValWalletUserId(e.target.value.trim())}
                disabled={valBusy}
                placeholder={partDisableAuth ? 'administrator' : 'operator'}
                helperText={
                  partDisableAuth
                    ? 'Ledger admin user for no-auth mode — default: administrator'
                    : 'Operator username from Keycloak realm (auto-filled from Keycloak Setup). Only this user can access the validator wallet — others get unrestricted access if blank.'
                }
              />

              {/* Row 5: Auth (mirrors participant) + Resources */}
              <Stack direction='row' spacing={2} alignItems='flex-end'>
                <Box sx={{ flex: 1 }}>
                  <Typography variant='caption' color='text.secondary' display='block' mb={0.5}>
                    Auth
                  </Typography>
                  <Box
                    sx={{
                      px: 1.5, py: 1,
                      border: '1px solid var(--mui-palette-divider)',
                      borderRadius: 1,
                      bgcolor: 'action.hover',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1
                    }}
                  >
                    <i className={`tabler-${partDisableAuth ? 'lock-open' : 'lock'} text-sm text-textSecondary`} />
                    <Typography variant='body2'>
                      {partDisableAuth ? 'Disabled (no OIDC)' : 'Enabled (OIDC)'}
                    </Typography>
                  </Box>
                  <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.7rem', mt: 0.5, display: 'block' }}>
                    Must match participant — set in Step 2
                  </Typography>
                </Box>

                <TextField
                  label='Resources'
                  select
                  size='small'
                  sx={{ flex: 1 }}
                  value={valReduceResources ? 'reduced' : 'default'}
                  onChange={e => setValReduceResources(e.target.value === 'reduced')}
                  disabled={valBusy}
                  helperText='k3s/small node → reduced'
                >
                  <MenuItem value='reduced'>Reduced (k3s / small node)</MenuItem>
                  <MenuItem value='default'>Default (chart values)</MenuItem>
                </TextField>
              </Stack>

              {!partDisableAuth && (
                <Stack spacing={2}>
                  <TextField
                    label='OIDC Authority URL'
                    size='small'
                    fullWidth
                    value={valOidcUrl}
                    onChange={e => setValOidcUrl(e.target.value.trim())}
                    disabled={valBusy}
                    placeholder='https://your-keycloak/realms/canton'
                  />
                  <TextField
                    label='OIDC Validator Audience'
                    size='small'
                    fullWidth
                    value={valOidcAudience}
                    onChange={e => setValOidcAudience(e.target.value.trim())}
                    disabled={valBusy}
                    placeholder='https://canton.network.global'
                  />
                </Stack>
              )}

              <Stack direction='row' justifyContent='flex-end' spacing={1}>
                <Button
                  variant='outlined'
                  size='small'
                  onClick={diagnoseValidator}
                  disabled={valBusy}
                >
                  Diagnose
                </Button>
                <Button
                  variant='contained'
                  disabled={valBusy || !participantRelease || !valSponsorSvUrl || !valContactPoint || !valScanUrl || !valSequencerUrl || (!validatorRelease && (!valOnboardingSecret || !valPartyHint))}
                  onClick={installValidator}
                  title={!participantRelease ? 'Install splice-participant first' : ''}
                >
                  {valBusy ? 'Installing…' : validatorRelease ? 'Upgrade' : 'Install'}
                </Button>
              </Stack>

              {!participantRelease && (
                <Alert severity='warning' sx={{ py: 0.5 }}>Install splice-participant first.</Alert>
              )}

              {valBusy && (
                <Box>
                  <Stack direction='row' alignItems='center' spacing={1} mb={0.5}>
                    <CircularProgress size={14} />
                    <Typography variant='body2' fontWeight={600} sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {valCurrentStep || 'Preparing…'}
                    </Typography>
                    <Typography variant='caption' color='text.secondary' sx={{ ml: 'auto !important' }}>
                      {fmtElapsed(valElapsed)}
                    </Typography>
                  </Stack>
                  <LinearProgress />
                </Box>
              )}

              {valBusy && valPods.length > 0 && (
                <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                  <Table size='small'>
                    <TableHead>
                      <TableRow>
                        <TableCell>Pod</TableCell>
                        <TableCell>Ready</TableCell>
                        <TableCell>Phase</TableCell>
                        <TableCell>Reason</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {valPods.map(p => (
                        <TableRow key={p.name}>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{p.name}</TableCell>
                          <TableCell sx={{ fontSize: 12 }}>{p.ready}</TableCell>
                          <TableCell>
                            <Chip
                              size='small'
                              label={p.phase}
                              color={p.phase === 'Running' ? 'success' : p.phase === 'Pending' ? 'warning' : 'default'}
                            />
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>{p.reason}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}

              {valDone && !valBusy && (
                <Stack spacing={1}>
                  <Alert severity='success'>splice-validator installed successfully.</Alert>
                  <Stack direction='row' alignItems='center' spacing={1}>
                    <Button
                      variant='outlined'
                      size='small'
                      color='secondary'
                      disabled={exposeBusy}
                      onClick={exposeServices}
                    >
                      {exposeBusy ? 'Exposing…' : exposedPorts ? 'Re-expose Services' : 'Expose Services (NodePort)'}
                    </Button>
                    {exposeBusy && <CircularProgress size={16} />}
                  </Stack>
                  {exposeError && <Alert severity='error' sx={{ py: 0.5 }}>{exposeError}</Alert>}
                  {exposedPorts && (
                    <Alert severity='info' sx={{ py: 0.5 }}>
                      <Typography variant='body2' fontWeight={600} gutterBottom>Services exposed:</Typography>
                      <Typography variant='body2'>
                        Wallet UI: <strong>http://{validator.host}:{exposedPorts.wallet}</strong>
                      </Typography>
                      <Typography variant='body2'>
                        ANS UI: <strong>http://{validator.host}:{exposedPorts.ans}</strong>
                      </Typography>
                      <Typography variant='body2'>
                        Validator API: <strong>http://{validator.host}:{exposedPorts.validatorApi}</strong>
                      </Typography>
                    </Alert>
                  )}
                </Stack>
              )}

              {valLog && (
                <Box
                  component='pre'
                  sx={{
                    bgcolor: 'background.default',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    p: 1.5,
                    fontSize: 11,
                    maxHeight: 180,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    m: 0,
                  }}
                >
                  {valLog}
                </Box>
              )}
            </Stack>
          </Box>

          <Divider />

          {/* ── 4. Keycloak (OIDC) ────────────────────────────────── */}
          <Box>
            <Stack direction='row' alignItems='center' spacing={1} mb={1.5}>
              <Chip label='4' size='small' color='primary' />
              <Typography variant='subtitle1' fontWeight='bold'>Keycloak (OIDC)</Typography>
              {kcDeployed && (
                <Chip size='small' label='Deployed' color='success' />
              )}
              <Typography variant='caption' color='text.secondary' sx={{ ml: 'auto !important' }}>
                Optional
              </Typography>
            </Stack>

            <Stack spacing={2}>
              <Alert severity='info' sx={{ py: 0.5 }}>
                <Typography variant='caption'>
                  Deploy a self-hosted Keycloak OIDC server inside k3s. Creates realm + 4 Splice clients
                  automatically. Required for TestNet/MainNet; optional for DevNet.
                </Typography>
              </Alert>

              {kcDeployed && (
                <Alert severity='success' sx={{ py: 0.5 }}>
                  <Typography variant='body2' fontWeight={600} gutterBottom>
                    Keycloak deployed
                  </Typography>
                  <Typography variant='caption' display='block'>
                    Realm: <strong>{kcRealm}</strong>
                  </Typography>
                  <Typography variant='caption' display='block'>
                    Issuer: <code style={{ fontSize: '0.7rem' }}>{kcIssuerUrl}</code>
                  </Typography>
                  <Typography variant='caption' display='block' color='text.secondary'>
                    To enable OIDC, re-install participant + validator with Auth = Enabled and
                    OIDC Authority URL = the issuer above.
                  </Typography>
                </Alert>
              )}

              <Stack direction='row' spacing={2}>
                <TextField
                  label='Realm'
                  size='small'
                  value={kcRealm}
                  onChange={e => setKcRealm(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  disabled={kcBusy}
                  sx={{ width: 160 }}
                  helperText='Keycloak realm name'
                />
                <TextField
                  label='Base Domain'
                  size='small'
                  value={kcBaseDomain}
                  onChange={e => setKcBaseDomain(e.target.value.trim())}
                  disabled={kcBusy}
                  fullWidth
                  placeholder='askardex.com'
                  helperText={kcBaseDomain
                    ? `Ingress: auth.${kcBaseDomain}`
                    : 'Leave empty → NodePort :30180 (no HTTPS)'}
                />
              </Stack>

              {/* DNS check for auth.<baseDomain> */}
              {kcBaseDomain && (
                <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                  <Stack direction='row' alignItems='center' justifyContent='space-between' spacing={1}>
                    <Typography variant='caption' color='text.secondary'>
                      DNS A record required: <code style={{ fontSize: '0.75rem' }}>auth.{kcBaseDomain}</code> → <strong>{validator.host}</strong>
                    </Typography>
                    <Button
                      size='small'
                      variant='outlined'
                      onClick={verifyKcDns}
                      disabled={kcDnsLoading}
                      startIcon={kcDnsLoading ? <CircularProgress size={12} /> : <i className='tabler-search' />}
                      sx={{ textTransform: 'none', flexShrink: 0 }}
                    >
                      {kcDnsLoading ? 'Checking…' : kcDnsResult ? 'Re-check' : 'Verify DNS'}
                    </Button>
                  </Stack>
                  {kcDnsResult && (
                    <Box mt={1}>
                      {kcDnsResult.ok ? (
                        <Alert severity='success' sx={{ py: 0.5 }}>
                          <Typography variant='caption'>
                            ✓ auth.{kcBaseDomain} → {kcDnsResult.a.join(', ')}
                            {kcDnsResult.cfProxied && ' (via Cloudflare)'}
                          </Typography>
                        </Alert>
                      ) : (
                        <Alert severity='error' sx={{ py: 0.5 }}>
                          <Typography variant='caption'>
                            ✗ {kcDnsResult.error || `Resolved to ${kcDnsResult.a.join(', ') || 'nothing'} — expected ${validator.host}`}
                          </Typography>
                          <Typography variant='caption' display='block' mt={0.5}>
                            Add DNS A record: <code>auth.{kcBaseDomain}</code> → <code>{validator.host}</code>
                          </Typography>
                        </Alert>
                      )}
                    </Box>
                  )}
                </Box>
              )}

              <Stack direction='row' justifyContent='flex-end' spacing={1}>
                {kcDeployed && (
                  <Button
                    variant='outlined'
                    color='error'
                    size='small'
                    disabled={kcBusy}
                    onClick={removeKeycloak}
                  >
                    Remove
                  </Button>
                )}
                <Button
                  variant='contained'
                  disabled={kcBusy || !validatorRelease}
                  onClick={deployKeycloak}
                  title={!validatorRelease ? 'Install splice-validator first' : ''}
                >
                  {kcBusy ? 'Deploying…' : kcDeployed ? 'Re-deploy' : 'Deploy Keycloak'}
                </Button>
              </Stack>

              {!validatorRelease && (
                <Alert severity='warning' sx={{ py: 0.5 }}>Install splice-validator first.</Alert>
              )}

              {kcBusy && (
                <Box>
                  <Stack direction='row' alignItems='center' spacing={1} mb={0.5}>
                    <CircularProgress size={14} />
                    <Typography variant='body2' fontWeight={600} sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                      Deploying Keycloak…
                    </Typography>
                  </Stack>
                  <LinearProgress />
                </Box>
              )}

              {kcLog && (
                <Box
                  component='pre'
                  sx={{
                    bgcolor: 'background.default',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    p: 1.5,
                    fontSize: 11,
                    maxHeight: 180,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    m: 0,
                  }}
                >
                  {kcLog}
                </Box>
              )}
            </Stack>
          </Box>

          <Divider />

          {error && <Alert severity='error'>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={refreshStatus} disabled={pgBusy || partBusy || valBusy}>Refresh</Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
