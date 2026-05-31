'use client'

import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import LinearProgress from '@mui/material/LinearProgress'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

import type { DnsResult, NetworkConfig, PublicForm, Validator } from './types'

export type PublicAccessDialogProps = {
  open: boolean
  saving: boolean
  error: string | null
  validator: Validator | null
  config: NetworkConfig | null
  form: PublicForm
  setForm: (f: PublicForm | ((p: PublicForm) => PublicForm)) => void
  dnsLoading: boolean
  dnsResults: DnsResult[] | null
  dnsExpectedIps: string[]
  dnsAllOk: boolean
  dnsError: string | null
  dnsFqdns: string[]
  sslApplying: boolean
  onClose: () => void
  onSave: () => void
  onVerifyDns: () => void
  onApplySsl: () => void
}

export function PublicAccessDialog({
  open, saving, error, validator, config, form, setForm,
  dnsLoading, dnsResults, dnsExpectedIps, dnsAllOk, dnsError, dnsFqdns,
  sslApplying, onClose, onSave, onVerifyDns, onApplySsl
}: PublicAccessDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={() => !saving && onClose()}
      maxWidth='sm'
      fullWidth
      PaperProps={{ sx: { maxInlineSize: 560 } }}
    >
      <DialogTitle className='flex items-center gap-2'>
        <i className='tabler-world-www text-primary' />
        Public Access (Domain &amp; SSL)
      </DialogTitle>
      {saving && <LinearProgress />}
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
          },
          '& .MuiInputBase-input::placeholder': {
            color: 'text.secondary',
            opacity: 0.6,
            fontStyle: 'italic'
          }
        }}
      >
        {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}

        <div className='flex flex-col gap-1 mb-4'>
          <Typography variant='caption' color='text.secondary'>Access Mode</Typography>
          <ToggleButtonGroup
            value={form.publicAccessMode}
            exclusive
            size='small'
            fullWidth
            onChange={(_, v) => v && setForm(f => ({ ...f, publicAccessMode: v }))}
          >
            <ToggleButton value='direct'>
              <div className='flex flex-col items-start text-left'>
                <span className='text-sm font-medium'>Direct IP</span>
                <span className='text-[0.7rem] opacity-70'>Use http://&lt;vps-ip&gt;:port</span>
              </div>
            </ToggleButton>
            <ToggleButton value='domain'>
              <div className='flex flex-col items-start text-left'>
                <span className='text-sm font-medium'>Custom Domain</span>
                <span className='text-[0.7rem] opacity-70'>nginx + optional SSL</span>
              </div>
            </ToggleButton>
          </ToggleButtonGroup>
        </div>

        {form.publicAccessMode === 'direct' ? (
          <Alert severity='info' sx={{ mb: 1 }}>
            Wallet/ANS UIs will be reachable directly via the VPS IP and Splice container ports
            (wallet :3000, ANS :3001). Suitable for local testing. <strong>OIDC authentication
            cannot be enabled in this mode</strong> &mdash; Auth0/Keycloak require an https callback URL.
          </Alert>
        ) : (
          <>
            <Alert severity='info' sx={{ mb: 2 }}>
              Point each FQDN below to your VPS public IP via DNS A records <em>before</em> saving.
              NodePilot will deploy the nginx reverse proxy in the next step.
              Reloading nginx is graceful &mdash; no Splice restart required.
            </Alert>

            <div className='flex flex-col gap-1 mb-3'>
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
                    <span className='text-[0.7rem] opacity-70'>wallet.x.com &middot; ans.x.com &middot; &hellip;</span>
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

            <TextField
              fullWidth
              size='small'
              label='Base domain *'
              placeholder={form.routingMode === 'multi' ? 'mynode.com' : 'node.mynode.com'}
              value={form.baseDomain}
              onChange={e => setForm(f => ({ ...f, baseDomain: e.target.value }))}
              helperText={form.routingMode === 'multi'
                ? 'Root domain \u2014 each enabled service below becomes <subdomain>.<base>'
                : 'Single FQDN \u2014 services exposed at /wallet, /ans, /api, etc.'}
              sx={{ mb: 2 }}
            />

            <Divider textAlign='left' sx={{ mb: 1.5 }}>
              <Typography variant='caption' color='text.secondary'>Services</Typography>
            </Divider>

            {([
              { key: 'Wallet', enabledKey: 'enableWallet', subKey: 'walletSubdomain', label: 'Wallet UI', required: true, hint: 'OIDC redirect URI lives here' },
              { key: 'Ans', enabledKey: 'enableAns', subKey: 'ansSubdomain', label: 'ANS (CNS name service)', required: false, hint: 'Optional' },
              { key: 'Api', enabledKey: 'enableApi', subKey: 'apiSubdomain', label: 'Validator API (HTTP/JSON)', required: false, hint: 'JSON ledger API + admin' }
            ] as const).map(svc => {
              const enabled = form[svc.enabledKey]
              const sub = form[svc.subKey]

              const fqdn = form.routingMode === 'path'
                ? form.baseDomain
                : (sub && form.baseDomain ? `${sub}.${form.baseDomain}` : '')

              return (
                <div
                  key={svc.key}
                  className='px-3 py-2 mb-2 rounded-md'
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
                    {fqdn && enabled && (
                      <Typography variant='caption' color='success.main' className='truncate' sx={{ maxInlineSize: 220 }}>
                        {form.sslEnabled ? 'https://' : 'http://'}{fqdn}
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
                        .{form.baseDomain || '\u2026'}
                      </Typography>
                      <Typography variant='caption' color='text.disabled' sx={{ ml: 'auto' }}>
                        {svc.hint}
                      </Typography>
                    </div>
                  )}
                </div>
              )
            })}

            <details className='mb-2 rounded-md' style={{ border: '1px solid var(--mui-palette-divider)' }}>
              <summary className='px-3 py-2 text-sm cursor-pointer select-none' style={{ color: 'var(--mui-palette-text-secondary)' }}>
                Advanced endpoints
              </summary>
              <div className='px-3 pb-2'>
                {([
                  { key: 'Metrics', enabledKey: 'enableMetrics', subKey: 'metricsSubdomain', label: 'Prometheus metrics', hint: 'Restrict at firewall', warn: false },
                  { key: 'Grpc', enabledKey: 'enableGrpcLedger', subKey: 'grpcLedgerSubdomain', label: 'gRPC Ledger API (public)', hint: 'Requires OIDC', warn: true },
                  { key: 'Keycloak', enabledKey: 'enableKeycloak', subKey: 'keycloakSubdomain', label: 'Keycloak (OIDC server)', hint: 'Deploy Keycloak first', warn: false }
                ] as const).map(svc => {
                  const enabled = form[svc.enabledKey]
                  const sub = form[svc.subKey]

                  const fqdn = form.routingMode === 'path'
                    ? form.baseDomain
                    : (sub && form.baseDomain ? `${sub}.${form.baseDomain}` : '')

                  return (
                    <div key={svc.key} className='mt-2'>
                      <div className='flex items-center justify-between gap-2'>
                        <FormControlLabel
                          control={
                            <Switch
                              size='small'
                              checked={enabled}
                              onChange={e => setForm(f => ({ ...f, [svc.enabledKey]: e.target.checked }))}
                            />
                          }
                          label={<span className='text-sm'>{svc.label}</span>}
                        />
                        {fqdn && enabled && (
                          <Typography variant='caption' color='success.main' className='truncate' sx={{ maxInlineSize: 220 }}>
                            {form.sslEnabled ? 'https://' : 'http://'}{fqdn}
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
                            .{form.baseDomain || '\u2026'}
                          </Typography>
                          <Typography variant='caption' color={svc.warn ? 'warning.main' : 'text.disabled'} sx={{ ml: 'auto' }}>
                            {svc.hint}
                          </Typography>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </details>

            <details className='mb-2 rounded-md' style={{ border: '1px solid var(--mui-palette-divider)' }}>
              <summary className='px-3 py-2 text-sm cursor-pointer select-none' style={{ color: 'var(--mui-palette-text-secondary)' }}>
                Internal service ports (on VPS)
              </summary>
              <div className='px-3 pb-3'>
                <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 1.5 }}>
                  Ports each service listens on inside the VPS. Change only if your{' '}
                  <code>docker-compose.yaml</code> uses non-default values.
                </Typography>
                <div className='grid grid-cols-3 gap-2'>
                  {([
                    { key: 'portLedgerApi', label: 'gRPC Ledger', sub: 'participant gRPC' },
                    { key: 'portWalletUi', label: 'Wallet UI', sub: 'web interface' },
                    { key: 'portJsonApi', label: 'JSON Ledger', sub: 'REST/HTTP API' },
                    { key: 'portValidatorApi', label: 'Validator Admin', sub: 'livez / admin' },
                    { key: 'portSpliceNginx', label: 'Splice nginx', sub: 'internal proxy' }
                  ] as const).map(p => (
                    <TextField
                      key={p.key}
                      size='small'
                      type='number'
                      label={p.label}
                      value={form[p.key]}
                      onChange={e => setForm(f => ({ ...f, [p.key]: parseInt(e.target.value, 10) || 0 }))}
                      helperText={p.sub}
                      InputProps={{ inputProps: { min: 1, max: 65535 } }}
                    />
                  ))}
                </div>
                <Alert severity='warning' sx={{ mt: 1.5 }} icon={<i className='tabler-shield-lock' />}>
                  <Typography variant='caption'>
                    <strong>Firewall reminder:</strong> only ports <strong>80</strong> and <strong>443</strong>
                    {' '}need to be open publicly. The internal ports above must be reachable from <code>127.0.0.1</code> only &mdash;
                    add cloud-provider security-group rules if needed.
                  </Typography>
                </Alert>
              </div>
            </details>

            <Divider textAlign='left' sx={{ mb: 1.5 }}>
              <Typography variant='caption' color='text.secondary'>DNS Verification</Typography>
            </Divider>

            <div className='flex items-center justify-between gap-2 mb-2'>
              <Typography variant='caption' color='text.secondary' sx={{ flex: 1 }}>
                Confirm each FQDN resolves to <code>{validator?.host || '\u2014'}</code> before
                requesting SSL certificates.
              </Typography>
              <Button
                size='small'
                variant='outlined'
                onClick={onVerifyDns}
                disabled={dnsLoading || dnsFqdns.length === 0}
                startIcon={dnsLoading ? <CircularProgress size={12} /> : <i className='tabler-search' />}
                sx={{ textTransform: 'none', flexShrink: 0 }}
              >
                {dnsLoading ? 'Resolving\u2026' : dnsResults ? 'Re-check' : 'Verify DNS'}
              </Button>
            </div>

            {dnsFqdns.length === 0 && (
              <Alert severity='warning' sx={{ mb: 1.5 }}>
                <Typography variant='caption'>Configure base domain + at least one service to enable DNS check.</Typography>
              </Alert>
            )}

            {dnsError && (
              <Alert severity='error' sx={{ mb: 1.5 }}>
                <Typography variant='caption'>{dnsError}</Typography>
              </Alert>
            )}

            {dnsResults && (
              <div className='mb-3 rounded-md overflow-hidden' style={{ border: '1px solid var(--mui-palette-divider)' }}>
                <div className='px-3 py-1.5 flex items-center justify-between' style={{ backgroundColor: 'rgb(var(--mui-palette-action-selectedChannel) / 0.04)', borderBlockEnd: '1px solid var(--mui-palette-divider)' }}>
                  <Typography variant='caption' color='text.secondary'>
                    Expected: {dnsExpectedIps.length > 0 ? dnsExpectedIps.map(ip => <code key={ip} className='mx-1 text-xs'>{ip}</code>) : <em>unknown</em>}
                  </Typography>
                  <Typography variant='caption' fontWeight={600} color={dnsAllOk ? 'success.main' : 'warning.main'}>
                    {dnsAllOk
                      ? (dnsResults.some(r => r.cfProxied) ? '\u2713 OK (via Cloudflare)' : '\u2713 All match')
                      : '\u26A0 Fix DNS first'}
                  </Typography>
                </div>
                {dnsResults.map((r, i) => (
                  <div
                    key={r.fqdn}
                    className='flex items-center justify-between gap-2 px-3 py-1.5'
                    style={{ borderBlockEnd: i < dnsResults.length - 1 ? '1px solid var(--mui-palette-divider)' : 'none' }}
                  >
                    <Typography variant='caption' sx={{ fontFamily: 'monospace' }}>{r.fqdn}</Typography>
                    <Typography variant='caption' color='text.secondary' sx={{ fontFamily: 'monospace', fontSize: '0.65rem', ml: 'auto' }}>
                      {r.error ? <span style={{ color: 'var(--mui-palette-error-main)' }}>{r.error}</span> : ([...r.a, ...r.aaaa].join(', ') || '\u2014')}
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
              <Alert severity='info' sx={{ mb: 1.5 }} icon={<i className='tabler-cloud' />}>
                <Typography variant='caption'>
                  Cloudflare proxy detected. <strong>Let&apos;s Encrypt</strong> won&apos;t work
                  (CF intercepts port 80). Use <strong>Custom Certificate</strong> mode with a
                  Cloudflare Origin Certificate, or switch to DNS-only (gray cloud) in your CF dashboard.
                </Typography>
              </Alert>
            )}

            <Divider textAlign='left' sx={{ mb: 1.5 }}>
              <Typography variant='caption' color='text.secondary'>SSL</Typography>
            </Divider>

            <FormControlLabel
              control={
                <Switch
                  checked={form.sslEnabled}
                  onChange={e => setForm(f => ({ ...f, sslEnabled: e.target.checked }))}
                />
              }
              label='Enable SSL (HTTPS)'
              sx={{ mb: form.sslEnabled ? 2 : 0 }}
            />

            {form.sslEnabled && (
              <>
                <ToggleButtonGroup
                  value={form.sslMode}
                  exclusive
                  size='small'
                  fullWidth
                  onChange={(_, v) => v && setForm(f => ({ ...f, sslMode: v }))}
                  sx={{ mb: 2 }}
                >
                  <ToggleButton value='letsencrypt'>
                    <div className='flex flex-col items-start text-left'>
                      <span className='text-sm font-medium'>Let&apos;s Encrypt</span>
                      <span className='text-[0.7rem] opacity-70'>Auto-issue free cert</span>
                    </div>
                  </ToggleButton>
                  <ToggleButton value='custom'>
                    <div className='flex flex-col items-start text-left'>
                      <span className='text-sm font-medium'>Custom Certificate</span>
                      <span className='text-[0.7rem] opacity-70'>Paste your own cert &amp; key</span>
                    </div>
                  </ToggleButton>
                </ToggleButtonGroup>

                {form.sslMode === 'letsencrypt' && (
                  <TextField
                    fullWidth
                    size='small'
                    type='email'
                    label="Email for Let's Encrypt *"
                    placeholder='admin@mynode.com'
                    value={form.sslEmail}
                    onChange={e => setForm(f => ({ ...f, sslEmail: e.target.value }))}
                    helperText='Used for cert expiry notices. Never published.'
                  />
                )}

                {form.sslMode === 'custom' && (
                  <div className='flex flex-col gap-2'>
                    <TextField
                      fullWidth
                      size='small'
                      multiline
                      minRows={3}
                      maxRows={6}
                      label='Certificate (PEM) *'
                      placeholder={'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
                      value={form.customCertPem}
                      onChange={e => setForm(f => ({ ...f, customCertPem: e.target.value }))}
                      helperText='Full-chain PEM (cert + intermediate CA). Paste the entire content.'
                      InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.75rem' } }}
                    />
                    <TextField
                      fullWidth
                      size='small'
                      multiline
                      minRows={3}
                      maxRows={6}
                      label='Private Key (PEM) *'
                      placeholder={'-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
                      value={form.customKeyPem}
                      onChange={e => setForm(f => ({ ...f, customKeyPem: e.target.value }))}
                      helperText='RSA or ECDSA private key in PEM format. Never shared or logged.'
                      InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.75rem' } }}
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant='contained'
          startIcon={<i className='tabler-device-floppy' />}
          onClick={onSave}
          disabled={saving}
        >
          Save
        </Button>
        {form.publicAccessMode === 'domain' && (
          <Tooltip
            title={!config?.baseDomain
              ? 'Save configuration first'
              : !dnsAllOk
                ? 'Verify DNS first'
                : form.sslMode === 'custom'
                  ? 'Deploy custom SSL certificate on the VPS'
                  : 'Install nginx + request SSL cert on the VPS'}
            arrow
          >
            <span>
              <Button
                variant='contained'
                color='success'
                startIcon={<i className='tabler-rocket' />}
                onClick={onApplySsl}
                disabled={saving || sslApplying || !config?.baseDomain || !dnsAllOk}
              >
                Apply SSL
              </Button>
            </span>
          </Tooltip>
        )}
      </DialogActions>
    </Dialog>
  )
}
