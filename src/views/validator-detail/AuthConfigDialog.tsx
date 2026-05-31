'use client'

import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
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
import Typography from '@mui/material/Typography'

import type { AuthForm, NetworkConfig, Validator } from './types'

export type AuthConfigDialogProps = {
  open: boolean
  saving: boolean
  error: string | null
  validator: Validator | null
  config: NetworkConfig | null
  form: AuthForm
  setForm: (f: AuthForm | ((p: AuthForm) => AuthForm)) => void
  provider: 'auth0' | 'keycloak'
  setProvider: (p: 'auth0' | 'keycloak') => void
  onClose: () => void
  onSave: () => void
}

export function AuthConfigDialog({
  open, saving, error, validator, config, form, setForm,
  provider, setProvider, onClose, onSave
}: AuthConfigDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={() => !saving && onClose()}
      maxWidth='sm'
      fullWidth
      PaperProps={{ sx: { maxInlineSize: 620 } }}
    >
      <DialogTitle className='flex items-center gap-2'>
        <i className='tabler-shield-lock text-primary' />
        Authentication Configuration
      </DialogTitle>
      {saving && <LinearProgress />}
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
          },
          '& .MuiInputBase-input::placeholder': {
            color: 'text.secondary',
            opacity: 0.6,
            fontStyle: 'italic'
          },
          '& .MuiDivider-root': {
            marginBlockStart: 1
          }
        }}
      >
        <div className='flex flex-col gap-5'>
          {error && <Alert severity='error'>{error}</Alert>}

          <Alert severity={validator?.network === 'devnet' ? 'info' : 'warning'}>
            {validator?.network === 'devnet'
              ? 'DevNet: authentication is optional. Sponsor SV provides a demo OIDC tenant — leave disabled to use unsafe HMAC tokens for local testing.'
              : 'TestNet/MainNet require an OIDC provider (Auth0, Keycloak, etc.). All client credentials must be configured before starting.'}
          </Alert>

          <FormControlLabel
            control={
              <Switch
                checked={form.authEnabled}
                onChange={e => setForm(f => ({ ...f, authEnabled: e.target.checked }))}
              />
            }
            label='Enable OIDC authentication'
          />

          {form.authEnabled && (
            <>
              <div className='flex flex-col gap-2'>
                <Typography variant='caption' color='text.secondary' fontWeight={600}>
                  OIDC Provider
                </Typography>
                <ToggleButtonGroup
                  value={provider}
                  exclusive
                  size='small'
                  fullWidth
                  onChange={(_e, val: 'auth0' | 'keycloak' | null) => {
                    if (!val) return
                    setProvider(val)
                  }}
                >
                  <ToggleButton value='auth0' sx={{ textTransform: 'none', gap: 1 }}>
                    <i className='tabler-cloud text-base' />
                    Auth0 (managed SaaS)
                  </ToggleButton>
                  <ToggleButton value='keycloak' sx={{ textTransform: 'none', gap: 1 }}>
                    <i className='tabler-server text-base' />
                    Keycloak (self-hosted)
                  </ToggleButton>
                </ToggleButtonGroup>
              </div>

              <div
                className='flex items-start gap-2 px-3 py-2.5 rounded-md'
                style={{
                  backgroundColor: 'rgb(var(--mui-palette-info-mainChannel) / 0.06)',
                  border: '1px solid rgb(var(--mui-palette-info-mainChannel) / 0.25)'
                }}
              >
                <i className='tabler-info-circle text-info text-base shrink-0 mt-0.5' />
                {provider === 'auth0' ? (
                  <Typography variant='caption' sx={{ lineHeight: 1.6 }}>
                    <strong>Auth0</strong> — managed OIDC service.{' '}
                    <a href='https://auth0.com/signup' target='_blank' rel='noopener noreferrer' style={{ color: 'var(--mui-palette-primary-main)' }}>Sign up</a>
                    , create a tenant. In <strong>Applications</strong> create <strong>4 apps</strong>: 2× Machine-to-Machine
                    (validator backend, ledger API admin) and 2× Single Page Application (Wallet UI, ANS UI). Your tenant URL{' '}
                    <code style={{ fontSize: '0.7rem' }}>https://&lt;tenant&gt;.auth0.com/</code> is the issuer.{' '}
                    <a href='https://docs.dev.sync.global/app_dev/validator_users/validator_compose.html#configuring-authentication' target='_blank' rel='noopener noreferrer' style={{ color: 'var(--mui-palette-primary-main)' }}>Splice Auth0 guide →</a>
                  </Typography>
                ) : (
                  <Typography variant='caption' sx={{ lineHeight: 1.6 }}>
                    <strong>Keycloak</strong> — self-hosted OIDC server. You must run it yourself
                    (Docker, VPS, k8s).{' '}
                    <a href='https://www.keycloak.org/getting-started/getting-started-docker' target='_blank' rel='noopener noreferrer' style={{ color: 'var(--mui-palette-primary-main)' }}>Quick-start with Docker</a>
                    . Create a realm, then add <strong>4 clients</strong> in that realm: 2× confidential (validator backend, ledger API admin)
                    and 2× public (Wallet UI, ANS UI). Issuer URL is{' '}
                    <code style={{ fontSize: '0.7rem' }}>https://&lt;your-host&gt;/realms/&lt;realm&gt;</code>.{' '}
                    <a href='https://www.keycloak.org/docs/latest/server_admin/' target='_blank' rel='noopener noreferrer' style={{ color: 'var(--mui-palette-primary-main)' }}>Keycloak admin docs →</a>
                  </Typography>
                )}
              </div>

              <Divider textAlign='left'>
                <Typography variant='caption' color='text.secondary'>
                  {provider === 'auth0' ? 'Auth0 Tenant' : 'Keycloak Realm'}
                </Typography>
              </Divider>

              <TextField
                size='small'
                label='Auth URL (issuer)'
                placeholder={provider === 'auth0'
                  ? 'https://your-tenant.auth0.com/'
                  : 'https://keycloak.your-host.com/realms/canton'}
                value={form.authUrl}
                onChange={e => setForm(f => ({ ...f, authUrl: e.target.value }))}
                fullWidth
                helperText={provider === 'auth0'
                  ? 'Your Auth0 tenant root URL — find it in Auth0 dashboard → Applications → Settings → "Domain" (prepend https:// and append a trailing slash). Must match the "iss" claim of issued JWTs exactly.'
                  : 'Your Keycloak realm URL: https://<your-keycloak-host>/realms/<realm-name>. Find your realm name in the Keycloak admin console (top-left realm dropdown). Must match the "iss" claim of issued JWTs exactly.'}
              />
              <TextField
                size='small'
                label='JWKS URL'
                placeholder={provider === 'auth0'
                  ? 'https://your-tenant.auth0.com/.well-known/jwks.json'
                  : 'https://keycloak.your-host.com/realms/canton/protocol/openid-connect/certs'}
                value={form.authJwksUrl}
                onChange={e => setForm(f => ({ ...f, authJwksUrl: e.target.value }))}
                fullWidth
                helperText={provider === 'auth0'
                  ? 'Auth0: <issuer>/.well-known/jwks.json'
                  : 'Keycloak: <issuer>/protocol/openid-connect/certs'}
              />
              <TextField
                size='small'
                label='Well-known URL (optional)'
                placeholder={`${provider === 'auth0' ? 'https://your-tenant.auth0.com' : 'https://keycloak.your-host.com/realms/canton'}/.well-known/openid-configuration`}
                value={form.authWellknownUrl}
                onChange={e => setForm(f => ({ ...f, authWellknownUrl: e.target.value }))}
                fullWidth
                helperText='OIDC discovery endpoint. Same for both providers: <issuer>/.well-known/openid-configuration'
              />

              <Divider textAlign='left'>
                <Typography variant='caption' color='text.secondary'>Ledger API</Typography>
              </Divider>

              <TextField
                size='small'
                label='Ledger API audience'
                placeholder='https://canton.network.global'
                value={form.ledgerApiAudience}
                onChange={e => setForm(f => ({ ...f, ledgerApiAudience: e.target.value }))}
                fullWidth
                helperText={'Value of the "aud" claim in JWTs accepted by the participant ledger API. Must match what your OIDC tenant issues. Convention: "https://canton.network.global".'}
              />
              <div className='flex gap-3'>
                <TextField
                  size='small'
                  label='Ledger API scope (optional)'
                  placeholder='daml_ledger_api'
                  value={form.ledgerApiScope}
                  onChange={e => setForm(f => ({ ...f, ledgerApiScope: e.target.value }))}
                  fullWidth
                  helperText='Required for some IdPs (Microsoft Entra). Leave blank for Auth0/Keycloak.'
                />
                <TextField
                  size='small'
                  label='Ledger API admin user (sub)'
                  placeholder='ledger-api-user'
                  value={form.ledgerApiAdminUser}
                  onChange={e => setForm(f => ({ ...f, ledgerApiAdminUser: e.target.value }))}
                  fullWidth
                  helperText={'The "sub" claim of the M2M client used to bootstrap participant admin permissions.'}
                />
              </div>

              <Divider textAlign='left'>
                <Typography variant='caption' color='text.secondary'>Validator Backend</Typography>
              </Divider>

              <TextField
                size='small'
                label='Validator audience'
                placeholder='https://canton.network.global'
                value={form.validatorAudience}
                onChange={e => setForm(f => ({ ...f, validatorAudience: e.target.value }))}
                fullWidth
                helperText='Audience the validator backend expects in incoming JWTs. Usually same as Ledger API audience.'
              />
              <div className='flex gap-3'>
                <TextField
                  size='small'
                  label='Validator client ID'
                  value={form.validatorClientId}
                  onChange={e => setForm(f => ({ ...f, validatorClientId: e.target.value }))}
                  fullWidth
                  helperText={provider === 'auth0'
                    ? 'M2M app "Client ID" — Auth0 dashboard → Applications → your validator backend app → Settings.'
                    : 'Confidential client "Client ID" — Keycloak admin → Clients → your validator backend client → Settings.'}
                />
                <TextField
                  size='small'
                  type='password'
                  label={config?.hasValidatorClientSecret ? 'Validator client secret (leave blank to keep)' : 'Validator client secret'}
                  value={form.validatorClientSecret}
                  onChange={e => setForm(f => ({ ...f, validatorClientSecret: e.target.value }))}
                  fullWidth
                  helperText={provider === 'auth0'
                    ? '"Client Secret" on the same Auth0 Application page. Stored encrypted; never displayed back.'
                    : 'Keycloak admin → Clients → your client → Credentials tab → "Client secret". Stored encrypted; never displayed back.'}
                />
              </div>

              <Divider textAlign='left'>
                <Typography variant='caption' color='text.secondary'>Wallet & UI Clients</Typography>
              </Divider>

              <TextField
                size='small'
                label='Wallet admin user (sub)'
                placeholder='wallet-admin'
                value={form.walletAdminUser}
                onChange={e => setForm(f => ({ ...f, walletAdminUser: e.target.value }))}
                fullWidth
                helperText={'The "sub" of the user/M2M client granted wallet admin rights inside the participant.'}
              />
              <div className='flex gap-3'>
                <TextField
                  size='small'
                  label='Wallet UI client ID'
                  value={form.walletUiClientId}
                  onChange={e => setForm(f => ({ ...f, walletUiClientId: e.target.value }))}
                  fullWidth
                  helperText='SPA / public app client ID used by the Wallet web UI for browser logins.'
                />
                <TextField
                  size='small'
                  label='ANS UI client ID'
                  value={form.ansUiClientId}
                  onChange={e => setForm(f => ({ ...f, ansUiClientId: e.target.value }))}
                  fullWidth
                  helperText='SPA client ID used by the ANS (CNS name service) web UI.'
                />
              </div>

              <Divider textAlign='left'>
                <Typography variant='caption' color='text.secondary'>Misc</Typography>
              </Divider>

              <TextField
                size='small'
                label='Contact point (operator email)'
                placeholder='ops@example.com'
                value={form.contactPoint}
                onChange={e => setForm(f => ({ ...f, contactPoint: e.target.value }))}
                fullWidth
                helperText='Operator contact email — published on-chain so other validators / SVs can reach you.'
              />
            </>
          )}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant='contained'
          startIcon={saving ? <CircularProgress size={14} /> : <i className='tabler-device-floppy' />}
          onClick={onSave}
          disabled={saving}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
