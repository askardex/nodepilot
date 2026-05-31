'use client'

import { useState } from 'react'

import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

import type { NetworkConfig, Validator } from './types'

export type KeycloakSetupDialogProps = {
  open: boolean
  deploying: boolean
  validator: Validator | null
  config: NetworkConfig | null
  onClose: () => void
  onDeploy: (
    port: number,
    realm: string,
    adminUsername: string,
    adminPassword: string,
    operatorUsername: string,
    operatorPassword: string
  ) => void
  onRemove: () => void
}

export function KeycloakSetupDialog({
  open, deploying, validator, config, onClose, onDeploy, onRemove
}: KeycloakSetupDialogProps) {
  const [mode, setMode] = useState<'deploy' | 'external'>('deploy')
  const [port, setPort] = useState('8180')
  const [realm, setRealm] = useState('canton')
  const [adminUsername, setAdminUsername] = useState('admin')
  const [adminPassword, setAdminPassword] = useState('')
  const [operatorUsername, setOperatorUsername] = useState('operator')
  const [operatorPassword, setOperatorPassword] = useState('')
  const [confirmRedeploy, setConfirmRedeploy] = useState(false)

  const isDeployed = !!config?.keycloakDeployedAt
  const kcHost = validator?.host ?? ''
  const kcPort = config?.keycloakPort ?? 8180
  const kcRealm = config?.keycloakRealm ?? 'canton'
  const adminUrl = `http://${kcHost}:${kcPort}/admin`

  const portNum = parseInt(port)
  const portValid = !isNaN(portNum) && portNum >= 1024 && portNum <= 65535
  const realmValid = /^[a-z0-9][a-z0-9-]{1,30}$/i.test(realm)
  const usernameValid = (v: string) => /^[a-zA-Z0-9._-]{3,64}$/.test(v)
  const adminUsernameValid = usernameValid(adminUsername)
  const operatorUsernameValid = usernameValid(operatorUsername)
  const adminPasswordValid = adminPassword.length >= 8
  const operatorPasswordValid = operatorPassword.length >= 8

  const canDeploy =
    portValid &&
    realmValid &&
    adminUsernameValid &&
    operatorUsernameValid &&
    adminPasswordValid &&
    operatorPasswordValid &&
    !deploying

  return (
    <Dialog
      open={open}
      onClose={() => !deploying && onClose()}
      TransitionProps={{ onExited: () => setConfirmRedeploy(false) }}
      maxWidth='sm'
      fullWidth
      PaperProps={{ sx: { maxInlineSize: 600 } }}
    >
      <DialogTitle className='flex items-center gap-2'>
        <i className='tabler-key text-primary' />
        Keycloak Setup
        {isDeployed && (
          <Chip label='Deployed' color='success' size='small' sx={{ ml: 'auto', mr: 1 }} />
        )}
      </DialogTitle>

      {deploying && <LinearProgress />}

      <DialogContent
        dividers
        sx={{
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
        <div className='flex flex-col gap-4'>

          {/* Current status when deployed */}
          {isDeployed && (
            <div
              className='flex flex-col gap-1.5 rounded-md px-3 py-2.5'
              style={{
                backgroundColor: 'rgb(var(--mui-palette-success-mainChannel) / 0.08)',
                border: '1px solid rgb(var(--mui-palette-success-mainChannel) / 0.3)'
              }}
            >
              <div className='flex items-center gap-2'>
                <i className='tabler-circle-check text-success text-base' />
                <Typography variant='body2' fontWeight={600} color='success.main'>
                  Keycloak is running on this VPS
                </Typography>
              </div>
              <div className='flex flex-col gap-0.5 pl-5'>
                <Typography variant='caption' color='text.secondary'>
                  Port: <strong>{kcPort}</strong> · Realm: <strong>{kcRealm}</strong>
                </Typography>
                <Typography variant='caption' color='text.secondary'>
                  Admin console:{' '}
                  <a
                    href={adminUrl}
                    target='_blank'
                    rel='noopener noreferrer'
                    style={{ color: 'var(--mui-palette-primary-main)' }}
                  >
                    {adminUrl}
                  </a>
                  {config?.hasKeycloakAdminPass && (
                    <span> · password is stored on server and hidden for security</span>
                  )}
                </Typography>
                <Typography variant='caption' color='text.secondary'>
                  Auth Config has been pre-filled automatically. Restart the validator to apply auth.
                </Typography>
              </div>
            </div>
          )}

          {/* Mode selector */}
          <div className='flex flex-col gap-2'>
            <Typography variant='caption' color='text.secondary' fontWeight={600}>
              Setup mode
            </Typography>
            <ToggleButtonGroup
              value={mode}
              exclusive
              size='small'
              fullWidth
              onChange={(_e, val) => { if (val) setMode(val) }}
            >
              <ToggleButton value='deploy' sx={{ textTransform: 'none', gap: 1 }}>
                <i className='tabler-server text-base' />
                Deploy on this VPS
              </ToggleButton>
              <ToggleButton value='external' sx={{ textTransform: 'none', gap: 1 }}>
                <i className='tabler-cloud text-base' />
                Use existing Keycloak
              </ToggleButton>
            </ToggleButtonGroup>
          </div>

          {/* ── DEPLOY mode ───────────────────────────────────────── */}
          {mode === 'deploy' && (
            <>
              <Alert severity='info' sx={{ '& .MuiAlert-message': { fontSize: '0.78rem' } }}>
                Nodepilot will SSH into your VPS, run a Keycloak container (Docker), create realm{' '}
                <strong>{realm || 'canton'}</strong>, and generate 4 Splice clients automatically.
                Auth Config will be pre-filled. Works for DevNet, TestNet, and MainNet.
              </Alert>

              <div
                className='flex items-start gap-2 px-3 py-2.5 rounded-md'
                style={{
                  backgroundColor: 'rgb(var(--mui-palette-warning-mainChannel) / 0.06)',
                  border: '1px solid rgb(var(--mui-palette-warning-mainChannel) / 0.25)'
                }}
              >
                <i className='tabler-alert-triangle text-warning text-sm shrink-0 mt-0.5' />
                <Typography variant='caption' sx={{ lineHeight: 1.6 }}>
                  Keycloak will be bound to <strong>localhost:{port || '8180'}</strong> on the VPS.
                  To expose it publicly (required for OIDC redirect), add a subdomain (e.g.{' '}
                  <code style={{ fontSize: '0.7rem' }}>auth.yourdomain.com</code>) in your Public
                  Access config and proxy it to this port.
                </Typography>
              </div>

              <div className='flex gap-3'>
                <TextField
                  size='small'
                  label='Container port'
                  value={port}
                  onChange={e => setPort(e.target.value)}
                  error={port !== '' && !portValid}
                  helperText={
                    port !== '' && !portValid
                      ? 'Must be 1024–65535'
                      : 'Port on VPS that Keycloak listens on (default 8180)'
                  }
                  sx={{ width: 160 }}
                  disabled={deploying}
                />
                <TextField
                  size='small'
                  label='Realm name'
                  value={realm}
                  onChange={e => setRealm(e.target.value.toLowerCase())}
                  error={realm !== '' && !realmValid}
                  helperText={
                    realm !== '' && !realmValid
                      ? 'Lowercase letters, digits, hyphens only'
                      : 'Keycloak realm for Canton Network (default: canton)'
                  }
                  fullWidth
                  disabled={deploying}
                />
              </div>

              <Divider textAlign='left'>
                <Typography variant='caption' color='text.secondary'>
                  Bootstrap credentials (required)
                </Typography>
              </Divider>

              <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                <TextField
                  size='small'
                  label='Admin username'
                  value={adminUsername}
                  onChange={e => setAdminUsername(e.target.value)}
                  error={adminUsername !== '' && !adminUsernameValid}
                  helperText={
                    adminUsername !== '' && !adminUsernameValid
                      ? '3-64 chars: letters, digits, dot, underscore, hyphen'
                      : 'Master realm admin username'
                  }
                  disabled={deploying}
                />
                <TextField
                  size='small'
                  type='password'
                  label='Admin password'
                  value={adminPassword}
                  onChange={e => setAdminPassword(e.target.value)}
                  error={adminPassword !== '' && !adminPasswordValid}
                  helperText={
                    adminPassword !== '' && !adminPasswordValid
                      ? 'Minimum 8 characters'
                      : 'Will be encrypted and hidden after deploy'
                  }
                  disabled={deploying}
                />
                <TextField
                  size='small'
                  label='Operator username'
                  value={operatorUsername}
                  onChange={e => setOperatorUsername(e.target.value)}
                  error={operatorUsername !== '' && !operatorUsernameValid}
                  helperText={
                    operatorUsername !== '' && !operatorUsernameValid
                      ? '3-64 chars: letters, digits, dot, underscore, hyphen'
                      : `Wallet admin user in realm ${realm || 'canton'}`
                  }
                  disabled={deploying}
                />
                <TextField
                  size='small'
                  type='password'
                  label='Operator password'
                  value={operatorPassword}
                  onChange={e => setOperatorPassword(e.target.value)}
                  error={operatorPassword !== '' && !operatorPasswordValid}
                  helperText={
                    operatorPassword !== '' && !operatorPasswordValid
                      ? 'Minimum 8 characters'
                      : 'Will be encrypted and hidden after deploy'
                  }
                  disabled={deploying}
                />
              </div>

              <Divider textAlign='left'>
                <Typography variant='caption' color='text.secondary'>
                  Clients created automatically
                </Typography>
              </Divider>

              <div className='flex flex-col gap-1.5'>
                {[
                  { name: 'validator-backend', type: 'Confidential (service-to-service)' },
                  { name: 'ledger-api', type: 'Confidential (gRPC admin)' },
                  { name: 'wallet-ui', type: 'Public SPA (browser)' },
                  { name: 'ans-ui', type: 'Public SPA (browser)' }
                ].map(c => (
                  <div key={c.name} className='flex items-center gap-2'>
                    <i className='tabler-apps text-info text-sm' />
                    <Typography variant='caption'>
                      <strong>{c.name}</strong>
                      <span className='text-textSecondary'> — {c.type}</span>
                    </Typography>
                  </div>
                ))}
              </div>

              <Alert severity='warning' sx={{ '& .MuiAlert-message': { fontSize: '0.78rem' } }}>
                First pull downloads ~400 MB. The process takes 3–5 minutes. Keep this dialog open.
              </Alert>

              {isDeployed && !confirmRedeploy && (
                <div
                  className='flex items-start gap-2 rounded-md px-3 py-2.5'
                  style={{
                    background: 'rgb(var(--mui-palette-error-mainChannel) / 0.07)',
                    border: '1px solid rgb(var(--mui-palette-error-mainChannel) / 0.3)'
                  }}
                >
                  <i className='tabler-alert-triangle text-error text-base shrink-0 mt-0.5' />
                  <div className='flex flex-col gap-1'>
                    <Typography variant='caption' fontWeight={700} color='error.main'>
                      Re-deploying will remove the existing Keycloak container
                    </Typography>
                    <Typography variant='caption' color='text.secondary'>
                      Realm <strong>{config?.keycloakRealm}</strong>, all clients, and generated secrets will be lost.
                      The validator must be restarted after re-deploy completes.
                    </Typography>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── EXTERNAL mode ─────────────────────────────────────── */}
          {mode === 'external' && (
            <>
              <Alert severity='info' sx={{ '& .MuiAlert-message': { fontSize: '0.78rem' } }}>
                If you already have a Keycloak server running (on another VPS, k8s, or managed
                service), configure it manually in <strong>Authentication Config</strong>.
              </Alert>

              <div className='flex flex-col gap-2.5'>
                <Typography variant='caption' color='text.secondary' fontWeight={600}>
                  What you need from your Keycloak instance:
                </Typography>

                {[
                  {
                    label: 'Issuer URL',
                    value: 'https://your-keycloak/realms/canton',
                    desc: 'Goes into Auth URL field'
                  },
                  {
                    label: 'JWKS URL',
                    value: 'https://your-keycloak/realms/canton/protocol/openid-connect/certs',
                    desc: 'Public key endpoint for JWT verification'
                  },
                  {
                    label: '4 clients',
                    value: 'validator-backend · ledger-api · wallet-ui · ans-ui',
                    desc: 'Create them in your realm → Applications'
                  },
                  {
                    label: 'Client secrets',
                    value: 'For validator-backend and ledger-api (confidential clients)',
                    desc: 'Goes into Validator Client Secret field'
                  }
                ].map(item => (
                  <div key={item.label} className='flex flex-col gap-0.5 pl-2 border-l-2 border-divider'>
                    <Typography variant='caption' fontWeight={600}>{item.label}</Typography>
                    <Typography variant='caption' color='text.secondary' sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                      {item.value}
                    </Typography>
                    <Typography variant='caption' color='text.secondary'>{item.desc}</Typography>
                  </div>
                ))}
              </div>

              <div className='flex items-center gap-1.5'>
                <i className='tabler-external-link text-primary text-sm' />
                <Typography variant='caption'>
                  <a
                    href='https://www.keycloak.org/getting-started/getting-started-docker'
                    target='_blank'
                    rel='noopener noreferrer'
                    style={{ color: 'var(--mui-palette-primary-main)' }}
                  >
                    Keycloak quick-start with Docker
                  </a>
                  {' '}·{' '}
                  <a
                    href='https://docs.dev.sync.global/app_dev/validator_users/validator_compose.html#configuring-authentication'
                    target='_blank'
                    rel='noopener noreferrer'
                    style={{ color: 'var(--mui-palette-primary-main)' }}
                  >
                    Splice auth guide
                  </a>
                </Typography>
              </div>

              <Alert severity='success' sx={{ '& .MuiAlert-message': { fontSize: '0.78rem' } }}>
                After you have the URLs and secrets, open <strong>Authentication Config</strong> card
                and fill in the fields there.
              </Alert>
            </>
          )}

        </div>
      </DialogContent>

      <DialogActions sx={{ gap: 1, px: 3, py: 2 }}>
        {/* Remove button (only when deployed) */}
        {isDeployed && (
          <Tooltip title='Stop and remove the Keycloak container from the VPS'>
            <IconButton
              size='small'
              color='error'
              onClick={onRemove}
              disabled={deploying}
              sx={{ mr: 'auto' }}
            >
              <i className='tabler-trash text-base' />
            </IconButton>
          </Tooltip>
        )}

        <Button onClick={onClose} disabled={deploying} color='inherit' size='small'>
          {mode === 'external' ? 'Close' : 'Cancel'}
        </Button>

        {mode === 'deploy' && (
          isDeployed && !confirmRedeploy
            ? (
              <Button
                variant='outlined'
                color='error'
                size='small'
                startIcon={<i className='tabler-alert-triangle text-base' />}
                onClick={() => setConfirmRedeploy(true)}
                disabled={deploying}
              >
                Confirm Re-deploy
              </Button>
            ) : (
              <Button
                variant='contained'
                onClick={() => {
                  setConfirmRedeploy(false)
                  onDeploy(portNum, realm, adminUsername, adminPassword, operatorUsername, operatorPassword)
                }}
                disabled={!canDeploy}
                startIcon={
                  deploying
                    ? <i className='tabler-loader-2 text-base animate-spin' />
                    : isDeployed
                      ? <i className='tabler-refresh text-base' />
                      : <i className='tabler-rocket text-base' />
                }
              >
                {isDeployed ? 'Re-deploy (replace existing)' : 'Deploy Keycloak'}
              </Button>
            )
        )}

        {mode === 'external' && (
          <Button
            variant='outlined'
            onClick={onClose}
          >
            Open Auth Config
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
