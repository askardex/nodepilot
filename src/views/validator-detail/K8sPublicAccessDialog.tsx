'use client'

import { useState, useEffect, useMemo } from 'react'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Switch from '@mui/material/Switch'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

import type { DnsResult, Validator } from './types'

// ─── Types ──────────────────────────────────────────────────────────────────

export type K8sPublicForm = {
  routingMode: 'multi' | 'path'
  baseDomain: string
  enableWallet: boolean
  walletSubdomain: string
  enableAns: boolean
  ansSubdomain: string
  enableApi: boolean
  apiSubdomain: string
  tlsEnabled: boolean
  tlsMode: 'letsencrypt' | 'custom'
  tlsEmail: string
  customCertPem: string
  customKeyPem: string
}

const DEFAULT_FORM: K8sPublicForm = {
  routingMode: 'multi',
  baseDomain: '',
  enableWallet: true,
  walletSubdomain: 'wallet',
  enableAns: true,
  ansSubdomain: 'ans',
  enableApi: false,
  apiSubdomain: 'api',
  tlsEnabled: false,
  tlsMode: 'letsencrypt',
  tlsEmail: '',
  customCertPem: '',
  customKeyPem: ''
}

// ─── Dialog ──────────────────────────────────────────────────────────────────

export type K8sPublicAccessDialogProps = {
  open: boolean
  validator: Validator
  onClose: () => void
}

export function K8sPublicAccessDialog({ open, validator, onClose }: K8sPublicAccessDialogProps) {
  const [tab, setTab] = useState(0) // 0 = NodePort, 1 = Ingress

  // ── NodePort state ────────────────────────────────────────────────────────
  const [exposeBusy, setExposeBusy] = useState(false)
  const [exposedPorts, setExposedPorts] = useState<{ wallet: number; ans: number; validatorApi: number } | null>(null)
  const [exposeError, setExposeError] = useState<string | null>(null)

  // ── Ingress state ─────────────────────────────────────────────────────────
  const [form, setForm] = useState<K8sPublicForm>(DEFAULT_FORM)
  const [certMgrStatus, setCertMgrStatus] = useState<'unknown' | 'installed' | 'missing'>('unknown')
  const [ingressApplied, setIngressApplied] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applyLog, setApplyLog] = useState<string[]>([])

  // ── DNS state ─────────────────────────────────────────────────────────────
  const [dnsLoading, setDnsLoading] = useState(false)
  const [dnsResults, setDnsResults] = useState<DnsResult[] | null>(null)
  const [dnsExpectedIps, setDnsExpectedIps] = useState<string[]>([])
  const [dnsAllOk, setDnsAllOk] = useState(false)
  const [dnsError, setDnsError] = useState<string | null>(null)

  // ── TLS cert state ────────────────────────────────────────────────────────
  const [tlsSecretExists, setTlsSecretExists] = useState(false)
  const [tlsCertInfo, setTlsCertInfo] = useState<{ subject: string; issuer: string; notAfter: string; sans: string[] } | null>(null)

  // ── Load status on open ───────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    let cancelled = false

    fetch(`/api/validators/${validator.id}/k8s/ingress-status`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d.exposedPorts) setExposedPorts(d.exposedPorts)
        if (d.ingress) {
          setForm(f => ({ ...f, ...d.ingress }))
          setIngressApplied(true)
        }
        if (d.certManagerInstalled === true) setCertMgrStatus('installed')
        else if (d.certManagerInstalled === false) setCertMgrStatus('missing')
        if (d.tlsSecretExists) setTlsSecretExists(true)
        if (d.tlsCertInfo) setTlsCertInfo(d.tlsCertInfo)
      })
      .catch(() => { /* non-fatal */ })

    return () => { cancelled = true }
  }, [open, validator.id])

  // ── Computed FQDNs ────────────────────────────────────────────────────────
  const dnsFqdns = useMemo(() => {
    if (!form.baseDomain) return []
    const base = form.baseDomain.trim()
    if (form.routingMode === 'path') return [base]
    const list: string[] = []
    const add = (sub: string, enabled: boolean) => {
      if (!enabled) return
      const f = sub.trim() ? `${sub.trim()}.${base}` : base
      if (!list.includes(f)) list.push(f)
    }
    add(form.walletSubdomain, form.enableWallet)
    add(form.ansSubdomain, form.enableAns)
    add(form.apiSubdomain, form.enableApi)
    return list
  }, [form.baseDomain, form.routingMode, form.walletSubdomain, form.enableWallet,
      form.ansSubdomain, form.enableAns, form.apiSubdomain, form.enableApi])

  useEffect(() => {
    setDnsResults(null)
    setDnsAllOk(false)
    setDnsError(null)
  }, [dnsFqdns])

  // ── Actions ───────────────────────────────────────────────────────────────
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

  const verifyDns = async () => {
    if (!dnsFqdns.length) return
    setDnsLoading(true)
    setDnsError(null)
    setDnsResults(null)
    try {
      const res = await fetch(
        `/api/validators/${validator.id}/dns-check?fqdns=${encodeURIComponent(dnsFqdns.join(','))}`
      )
      const data = await res.json()
      if (!res.ok) {
        setDnsError(data.error ?? `HTTP ${res.status}`)
      } else {
        setDnsResults(data.results)
        setDnsExpectedIps(data.expectedIps ?? [])
        setDnsAllOk(!!data.allOk)
      }
    } catch (e: any) {
      setDnsError(e?.message ?? 'Network error')
    } finally {
      setDnsLoading(false)
    }
  }

  const applyIngress = async () => {
    setApplying(true)
    setApplyError(null)
    setApplyLog([])
    try {
      const res = await fetch(`/api/validators/${validator.id}/k8s/apply-ingress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setApplyLog(data.applied ?? [])
      setIngressApplied(true)
    } catch (err: any) {
      setApplyError(err?.message || 'Failed to apply Ingress')
    } finally {
      setApplying(false)
    }
  }

  const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => {})

  // ── Derived URLs ──────────────────────────────────────────────────────────
  const proto = form.tlsEnabled ? 'https' : 'http'

  const ingressUrl = (sub: string, enabled: boolean, path: string) => {
    if (!enabled || !form.baseDomain) return null
    return form.routingMode === 'path'
      ? `${proto}://${form.baseDomain}/${path}`
      : `${proto}://${sub}.${form.baseDomain}`
  }

  const ingressWalletUrl = ingressUrl(form.walletSubdomain, form.enableWallet, 'wallet')
  const ingressAnsUrl    = ingressUrl(form.ansSubdomain,    form.enableAns,    'ans')
  const ingressApiUrl    = ingressUrl(form.apiSubdomain,    form.enableApi,    'api')

  const canApply =
    !!form.baseDomain.trim() &&
    (form.enableWallet || form.enableAns || form.enableApi) &&
    (!form.tlsEnabled || (
      form.tlsMode === 'letsencrypt'
        ? !!form.tlsEmail.trim()
        : (!!form.customCertPem.trim() && !!form.customKeyPem.trim()) || tlsSecretExists
    ))

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Dialog
      open={open}
      onClose={() => !applying && onClose()}
      maxWidth='sm'
      fullWidth
      PaperProps={{ sx: { maxInlineSize: 580 } }}
    >
      <DialogTitle className='flex items-center gap-2'>
        <i className='tabler-world-www text-primary' />
        Public Access
      </DialogTitle>

      {applying && <LinearProgress />}

      <DialogContent
        dividers
        className='custom-scroll'
        sx={{
          maxHeight: 'calc(100vh - 240px)',
          '& .MuiFormHelperText-root': {
            marginInlineStart: 0,
            marginBlockStart: 0.75,
            fontSize: '0.7rem',
            lineHeight: 1.55,
            color: 'text.secondary',
            opacity: 0.85
          }
        }}
      >
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ mb: 2.5, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab
            label='NodePort'
            icon={<i className='tabler-plug text-sm' />}
            iconPosition='start'
            sx={{ minHeight: 40, textTransform: 'none' }}
          />
          <Tab
            label='Ingress (Domain & TLS)'
            icon={<i className='tabler-topology-star text-sm' />}
            iconPosition='start'
            sx={{ minHeight: 40, textTransform: 'none' }}
          />
        </Tabs>

        {/* ── Tab 0: NodePort ────────────────────────────────────────────── */}
        {tab === 0 && (
          <div className='flex flex-col gap-3'>
            <Alert severity='info'>
              NodePort exposes services directly on the VPS public IP — no domain or DNS needed.{' '}
              <strong>OIDC authentication is not available</strong> in this mode (Auth0/Keycloak require an
              HTTPS callback URL).
            </Alert>

            {/* Port table */}
            <div className='rounded-md overflow-hidden' style={{ border: '1px solid var(--mui-palette-divider)' }}>
              <div
                className='px-3 py-1.5 flex items-center gap-4'
                style={{
                  backgroundColor: 'rgb(var(--mui-palette-action-selectedChannel) / 0.04)',
                  borderBlockEnd: '1px solid var(--mui-palette-divider)'
                }}
              >
                <Typography variant='caption' color='text.secondary' fontWeight={600} sx={{ minWidth: 110 }}>
                  Service
                </Typography>
                <Typography variant='caption' color='text.secondary' fontWeight={600}>
                  NodePort
                </Typography>
              </div>
              {([
                { label: 'Wallet UI',      port: exposedPorts?.wallet       ?? 30080, url: exposedPorts ? `http://${validator.host}:${exposedPorts.wallet}`       : null },
                { label: 'ANS UI',         port: exposedPorts?.ans          ?? 30081, url: exposedPorts ? `http://${validator.host}:${exposedPorts.ans}`          : null },
                { label: 'Validator API',  port: exposedPorts?.validatorApi ?? 30003, url: exposedPorts ? `http://${validator.host}:${exposedPorts.validatorApi}` : null }
              ] as const).map((row, i, arr) => (
                <div
                  key={row.label}
                  className='flex items-center gap-3 px-3 py-2'
                  style={{ borderBlockEnd: i < arr.length - 1 ? '1px solid var(--mui-palette-divider)' : 'none' }}
                >
                  <Typography variant='body2' sx={{ minWidth: 110 }}>{row.label}</Typography>
                  <Chip
                    size='small'
                    label={`:${row.port}`}
                    color={exposedPorts ? 'success' : 'default'}
                    sx={{ fontFamily: 'monospace', fontWeight: 600 }}
                  />
                  {row.url && (
                    <Typography
                      variant='caption'
                      sx={{ fontFamily: 'monospace', color: 'primary.main', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {row.url}
                    </Typography>
                  )}
                  {row.url && (
                    <Tooltip title='Copy URL'>
                      <IconButton size='small' onClick={() => copy(row.url!)}>
                        <i className='tabler-copy text-sm' />
                      </IconButton>
                    </Tooltip>
                  )}
                </div>
              ))}
            </div>

            {!exposedPorts && (
              <Alert severity='warning' sx={{ py: 0.5 }}>
                <Typography variant='caption'>
                  Services are not yet exposed as NodePort. Click "Expose Services" to patch them.
                </Typography>
              </Alert>
            )}

            {exposeError && <Alert severity='error' sx={{ py: 0.5 }}>{exposeError}</Alert>}

            <Button
              variant='contained'
              disabled={exposeBusy}
              startIcon={exposeBusy ? <CircularProgress size={14} /> : <i className='tabler-plug' />}
              onClick={exposeServices}
              sx={{ alignSelf: 'flex-start' }}
            >
              {exposeBusy ? 'Exposing…' : exposedPorts ? 'Re-expose Services' : 'Expose Services (NodePort)'}
            </Button>

            {exposedPorts && (
              <Alert severity='success' sx={{ py: 0.5 }}>
                <Typography variant='caption'>
                  NodePort active — open the URLs above in your browser. Admin API also available at port{' '}
                  <strong>30013</strong>.
                </Typography>
              </Alert>
            )}
          </div>
        )}

        {/* ── Tab 1: Ingress ──────────────────────────────────────────────── */}
        {tab === 1 && (
          <div className='flex flex-col gap-3'>
            <Alert severity='info'>
              Creates a <strong>Traefik Ingress</strong> (built into k3s) with optional TLS via
              cert-manager. DNS A records must point to{' '}
              <strong>{validator.host}</strong> before applying.
            </Alert>

            {certMgrStatus === 'missing' && (
              <Alert severity='warning' sx={{ py: 0.5 }}>
                <Typography variant='caption'>
                  cert-manager not detected — required only for Let&apos;s Encrypt TLS. Custom certificate
                  works without it.
                </Typography>
              </Alert>
            )}

            {/* Routing mode */}
            <div className='flex flex-col gap-1'>
              <Typography variant='caption' color='text.secondary'>Routing Layout</Typography>
              <ToggleButtonGroup
                value={form.routingMode}
                exclusive
                size='small'
                fullWidth
                onChange={(_, v) => v && setForm(f => ({ ...f, routingMode: v }))}
              >
                <ToggleButton value='multi'>
                  <div className='flex flex-col items-start text-left'>
                    <span className='text-sm font-medium'>Multi-Subdomain</span>
                    <span className='text-[0.7rem] opacity-70'>wallet.x.com &middot; ans.x.com</span>
                  </div>
                </ToggleButton>
                <ToggleButton value='path'>
                  <div className='flex flex-col items-start text-left'>
                    <span className='text-sm font-medium'>Path-Based</span>
                    <span className='text-[0.7rem] opacity-70'>x.com/wallet &middot; x.com/ans</span>
                  </div>
                </ToggleButton>
              </ToggleButtonGroup>
            </div>

            {/* Base domain */}
            <TextField
              fullWidth
              size='small'
              label='Base domain *'
              placeholder={form.routingMode === 'multi' ? 'mynode.com' : 'node.mynode.com'}
              value={form.baseDomain}
              onChange={e => setForm(f => ({ ...f, baseDomain: e.target.value }))}
              helperText={form.routingMode === 'multi'
                ? 'Root domain — each enabled service becomes <subdomain>.<base>'
                : 'Single FQDN — services exposed at /wallet, /ans, etc.'}
            />

            {/* Services */}
            <Divider textAlign='left' sx={{ mb: 0.5 }}>
              <Typography variant='caption' color='text.secondary'>Services</Typography>
            </Divider>

            {([
              { key: 'Wallet', enabledKey: 'enableWallet' as const, subKey: 'walletSubdomain' as const, label: 'Wallet UI',        required: true,  hint: 'OIDC redirect URI lives here', previewUrl: ingressWalletUrl },
              { key: 'Ans',    enabledKey: 'enableAns'    as const, subKey: 'ansSubdomain'    as const, label: 'ANS (Name Service)', required: false, hint: 'Optional',                   previewUrl: ingressAnsUrl },
              { key: 'Api',    enabledKey: 'enableApi'    as const, subKey: 'apiSubdomain'    as const, label: 'Validator API',     required: false, hint: 'HTTP JSON API',               previewUrl: ingressApiUrl }
            ]).map(svc => {
              const enabled = form[svc.enabledKey]
              const sub = form[svc.subKey]
              return (
                <div
                  key={svc.key}
                  className='px-3 py-2 rounded-md'
                  style={{ border: '1px solid var(--mui-palette-divider)' }}
                >
                  <div className='flex items-center justify-between gap-2'>
                    <FormControlLabel
                      control={
                        <Switch
                          size='small'
                          checked={enabled}
                          disabled={svc.required}
                          onChange={e => setForm(f => ({ ...f, [svc.enabledKey]: e.target.checked }))}
                        />
                      }
                      label={
                        <span className='text-sm font-medium'>
                          {svc.label}{svc.required && ' *'}
                        </span>
                      }
                    />
                    {svc.previewUrl && enabled && (
                      <Typography
                        variant='caption'
                        color='success.main'
                        className='truncate'
                        sx={{ maxInlineSize: 220 }}
                      >
                        {svc.previewUrl}
                      </Typography>
                    )}
                  </div>
                  {enabled && form.routingMode === 'multi' && (
                    <div className='flex items-center gap-2 mt-1'>
                      <TextField
                        size='small'
                        value={sub}
                        onChange={e => setForm(f => ({ ...f, [svc.subKey]: e.target.value }))}
                        sx={{ inlineSize: 140 }}
                      />
                      <Typography variant='caption' color='text.secondary' sx={{ fontFamily: 'monospace' }}>
                        .{form.baseDomain || '…'}
                      </Typography>
                      <Typography variant='caption' color='text.disabled' sx={{ ml: 'auto' }}>
                        {svc.hint}
                      </Typography>
                    </div>
                  )}
                </div>
              )
            })}

            {/* DNS Verification */}
            <Divider textAlign='left' sx={{ mb: 0.5 }}>
              <Typography variant='caption' color='text.secondary'>DNS Verification</Typography>
            </Divider>

            <div className='flex items-center justify-between gap-2'>
              <Typography variant='caption' color='text.secondary' sx={{ flex: 1 }}>
                Confirm each FQDN resolves to{' '}
                <code>{validator.host}</code> before applying Ingress.
              </Typography>
              <Button
                size='small'
                variant='outlined'
                onClick={verifyDns}
                disabled={dnsLoading || !dnsFqdns.length}
                startIcon={dnsLoading ? <CircularProgress size={12} /> : <i className='tabler-search' />}
                sx={{ textTransform: 'none', flexShrink: 0 }}
              >
                {dnsLoading ? 'Resolving…' : dnsResults ? 'Re-check' : 'Verify DNS'}
              </Button>
            </div>

            {!dnsFqdns.length && (
              <Alert severity='warning' sx={{ py: 0.5 }}>
                <Typography variant='caption'>
                  Configure base domain + at least one service to enable DNS check.
                </Typography>
              </Alert>
            )}

            {dnsError && <Alert severity='error' sx={{ py: 0.5 }}>{dnsError}</Alert>}

            {dnsResults && (
              <div className='rounded-md overflow-hidden' style={{ border: '1px solid var(--mui-palette-divider)' }}>
                <div
                  className='px-3 py-1.5 flex items-center justify-between'
                  style={{
                    backgroundColor: 'rgb(var(--mui-palette-action-selectedChannel) / 0.04)',
                    borderBlockEnd: '1px solid var(--mui-palette-divider)'
                  }}
                >
                  <Typography variant='caption' color='text.secondary'>
                    Expected:{' '}
                    {dnsExpectedIps.length > 0
                      ? dnsExpectedIps.map(ip => <code key={ip} className='mx-1 text-xs'>{ip}</code>)
                      : <em>unknown</em>}
                  </Typography>
                  <Typography
                    variant='caption'
                    fontWeight={600}
                    color={dnsAllOk ? 'success.main' : 'warning.main'}
                  >
                    {dnsAllOk
                      ? (dnsResults.some(r => r.cfProxied) ? '✓ OK (via Cloudflare)' : '✓ All match')
                      : '⚠ Fix DNS first'}
                  </Typography>
                </div>
                {dnsResults.map((r, i) => (
                  <div
                    key={r.fqdn}
                    className='flex items-center justify-between gap-2 px-3 py-1.5'
                    style={{ borderBlockEnd: i < dnsResults.length - 1 ? '1px solid var(--mui-palette-divider)' : 'none' }}
                  >
                    <Typography variant='caption' sx={{ fontFamily: 'monospace' }}>{r.fqdn}</Typography>
                    <Typography
                      variant='caption'
                      color='text.secondary'
                      sx={{ fontFamily: 'monospace', fontSize: '0.65rem', ml: 'auto' }}
                    >
                      {r.error
                        ? <span style={{ color: 'var(--mui-palette-error-main)' }}>{r.error}</span>
                        : ([...r.a, ...r.aaaa].join(', ') || '—')}
                    </Typography>
                    {r.ok && r.cfProxied ? (
                      <Chip size='small' label='CF Proxy' color='info' sx={{ blockSize: 18, fontSize: '0.6rem', '& .MuiChip-label': { paddingInline: 0.75 } }} />
                    ) : r.ok ? (
                      <Chip size='small' label='OK' color='success' sx={{ blockSize: 18, fontSize: '0.6rem', '& .MuiChip-label': { paddingInline: 0.75 } }} />
                    ) : r.error ? (
                      <Chip size='small' label='Fail' color='error' sx={{ blockSize: 18, fontSize: '0.6rem', '& .MuiChip-label': { paddingInline: 0.75 } }} />
                    ) : (
                      <Chip size='small' label='Mismatch' color='warning' sx={{ blockSize: 18, fontSize: '0.6rem', '& .MuiChip-label': { paddingInline: 0.75 } }} />
                    )}
                  </div>
                ))}
              </div>
            )}

            {dnsResults?.some(r => r.cfProxied) && (
              <Alert severity='info' sx={{ py: 0.5 }} icon={<i className='tabler-cloud' />}>
                <Typography variant='caption'>
                  Cloudflare proxy detected. <strong>Let&apos;s Encrypt</strong> won&apos;t work (CF intercepts
                  port 80). Use <strong>Custom Certificate</strong> with a Cloudflare Origin Certificate, or
                  switch to DNS-only (grey cloud) in your CF dashboard.
                </Typography>
              </Alert>
            )}

            {/* TLS / SSL */}
            <Divider textAlign='left' sx={{ mb: 0.5 }}>
              <Typography variant='caption' color='text.secondary'>TLS / SSL</Typography>
            </Divider>

            <FormControlLabel
              control={
                <Switch
                  checked={form.tlsEnabled}
                  onChange={e => setForm(f => ({ ...f, tlsEnabled: e.target.checked }))}
                />
              }
              label='Enable TLS'
            />

            {form.tlsEnabled && (
              <div className='flex flex-col gap-2'>
                <ToggleButtonGroup
                  value={form.tlsMode}
                  exclusive
                  size='small'
                  fullWidth
                  onChange={(_, v) => v && setForm(f => ({ ...f, tlsMode: v }))}
                >
                  <ToggleButton value='letsencrypt'>
                    <div className='flex flex-col items-start text-left'>
                      <span className='text-sm font-medium'>Let&apos;s Encrypt</span>
                      <span className='text-[0.7rem] opacity-70'>cert-manager + ACME http01</span>
                    </div>
                  </ToggleButton>
                  <ToggleButton value='custom'>
                    <div className='flex flex-col items-start text-left'>
                      <span className='text-sm font-medium'>Custom Certificate</span>
                      <span className='text-[0.7rem] opacity-70'>Paste PEM cert + key</span>
                    </div>
                  </ToggleButton>
                </ToggleButtonGroup>

                {form.tlsMode === 'letsencrypt' && (
                  <>
                    {certMgrStatus !== 'installed' && (
                      <Alert severity='warning' sx={{ py: 0.5 }}>
                        <Typography variant='caption'>
                          cert-manager is required for Let&apos;s Encrypt. Install it with:{' '}
                          <code style={{ fontSize: '0.65rem', wordBreak: 'break-all' }}>
                            kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
                          </code>
                        </Typography>
                      </Alert>
                    )}
                    <TextField
                      size='small'
                      fullWidth
                      label='ACME Email *'
                      type='email'
                      placeholder='admin@example.com'
                      value={form.tlsEmail}
                      onChange={e => setForm(f => ({ ...f, tlsEmail: e.target.value }))}
                      helperText="Used for Let's Encrypt certificate registration and expiry notices"
                    />
                  </>
                )}

                {form.tlsMode === 'custom' && (
                  <>
                    {tlsSecretExists && tlsCertInfo && (
                      <Alert severity='success' sx={{ py: 0.5 }}>
                        <Typography variant='caption' fontWeight={600} display='block'>
                          ✓ SSL Certificate Active
                        </Typography>
                        <Typography variant='caption' display='block'>
                          Issuer: {tlsCertInfo.issuer}
                        </Typography>
                        <Typography variant='caption' display='block'>
                          SANs: {tlsCertInfo.sans.join(', ') || '—'}
                        </Typography>
                        <Typography variant='caption' display='block'>
                          Expires: {tlsCertInfo.notAfter}
                        </Typography>
                        <Typography variant='caption' display='block' color='text.secondary' mt={0.5}>
                          Leave the fields below empty to keep the current certificate.
                          Fill them only to <strong>replace</strong> the certificate.
                        </Typography>
                      </Alert>
                    )}
                    {tlsSecretExists && !tlsCertInfo && (
                      <Alert severity='info' sx={{ py: 0.5 }}>
                        <Typography variant='caption'>
                          ✓ TLS secret exists in cluster. Leave fields empty to keep current certificate.
                        </Typography>
                      </Alert>
                    )}
                    <TextField
                      size='small'
                      fullWidth
                      multiline
                      minRows={4}
                      label={tlsSecretExists ? 'Certificate PEM (replace)' : 'Certificate PEM *'}
                      placeholder={'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
                      value={form.customCertPem}
                      onChange={e => setForm(f => ({ ...f, customCertPem: e.target.value }))}
                      helperText={tlsSecretExists
                        ? 'Leave empty to keep current certificate — fill to replace'
                        : 'Full certificate chain in PEM format (including intermediates)'}
                      inputProps={{ style: { fontFamily: 'monospace', fontSize: 11 } }}
                    />
                    <TextField
                      size='small'
                      fullWidth
                      multiline
                      minRows={4}
                      label={tlsSecretExists ? 'Private Key PEM (replace)' : 'Private Key PEM *'}
                      placeholder={'-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
                      value={form.customKeyPem}
                      onChange={e => setForm(f => ({ ...f, customKeyPem: e.target.value }))}
                      helperText={tlsSecretExists
                        ? 'Leave empty to keep current key — fill to replace'
                        : 'Private key in PEM format — transmitted securely to VPS, not stored by NodePilot'}
                      inputProps={{ style: { fontFamily: 'monospace', fontSize: 11 } }}
                    />
                  </>
                )}
              </div>
            )}

            {/* Apply log */}
            {applyLog.length > 0 && (
              <Box
                component='pre'
                sx={{
                  bgcolor: 'background.default',
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  p: 1.5,
                  fontSize: 11,
                  fontFamily: 'monospace',
                  maxHeight: 140,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  m: 0
                }}
              >
                {applyLog.join('\n')}
              </Box>
            )}

            {applyError && (
              <Alert severity='error' sx={{ py: 0.5 }}>{applyError}</Alert>
            )}

            {ingressApplied && !applying && !applyError && (
              <Alert severity='success' sx={{ py: 0.5 }}>
                <Typography variant='body2' fontWeight={600} gutterBottom>
                  Ingress applied successfully.
                </Typography>
                {ingressWalletUrl && (
                  <Typography variant='body2'>
                    Wallet UI:{' '}
                    <strong>
                      <a href={ingressWalletUrl} target='_blank' rel='noreferrer'>{ingressWalletUrl}</a>
                    </strong>
                  </Typography>
                )}
                {ingressAnsUrl && (
                  <Typography variant='body2'>
                    ANS UI:{' '}
                    <strong>
                      <a href={ingressAnsUrl} target='_blank' rel='noreferrer'>{ingressAnsUrl}</a>
                    </strong>
                  </Typography>
                )}
                {ingressApiUrl && (
                  <Typography variant='body2'>
                    Validator API: <strong>{ingressApiUrl}</strong>
                  </Typography>
                )}
              </Alert>
            )}

            <div className='flex items-center justify-end'>
              <Button
                variant='contained'
                disabled={applying || !canApply}
                startIcon={applying ? <CircularProgress size={14} /> : <i className='tabler-topology-star' />}
                onClick={applyIngress}
              >
                {applying ? 'Applying…' : ingressApplied ? 'Re-apply Ingress' : 'Apply Ingress'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={applying}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
