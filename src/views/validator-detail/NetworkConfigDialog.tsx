'use client'

import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import LinearProgress from '@mui/material/LinearProgress'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import type { NetworkConfig, NetworkForm, Validator } from './types'

export type NetworkConfigDialogProps = {
  open: boolean
  saving: boolean
  error: string | null
  validator: Validator | null
  config: NetworkConfig | null
  form: NetworkForm
  setForm: (f: NetworkForm | ((p: NetworkForm) => NetworkForm)) => void
  secretBusy: boolean
  onClose: () => void
  onSave: () => void
  onClearError: () => void
  onGenerateDevnetSecret: () => void
}

export function NetworkConfigDialog({
  open, saving, error, validator, config, form, setForm,
  secretBusy, onClose, onSave, onClearError, onGenerateDevnetSecret
}: NetworkConfigDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={() => !saving && onClose()}
      maxWidth='sm'
      fullWidth
      PaperProps={{ sx: { maxInlineSize: 560 } }}
    >
      <DialogTitle className='flex items-center gap-2'>
        <i className='tabler-network text-primary' />
        Network Configuration
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
          }
        }}
      >
        <div className='flex flex-col gap-5 py-2'>
          <div
            className='flex items-start gap-3 px-3 py-2.5 rounded-md'
            style={{
              backgroundColor: 'rgb(var(--mui-palette-action-selectedChannel) / 0.04)',
              border: '1px solid var(--mui-palette-divider)'
            }}
          >
            <i className='tabler-info-circle text-textSecondary text-lg shrink-0 mt-0.5' />
            <Typography variant='caption' color='text.secondary' sx={{ lineHeight: 1.6 }}>
              Parameters required to onboard this validator to{' '}
              <strong>{validator?.network ?? 'the network'}</strong>. Get them from your sponsor SV{' '}
              {validator?.network === 'DevNet' && (
                <>(DevNet defaults pre-filled — adjust if your sponsor differs)</>
              )}
              . Onboarding secret expires 48 hours after issue —{' '}
              <a
                href='https://docs.dev.sync.global/'
                target='_blank'
                rel='noopener noreferrer'
                style={{ color: 'var(--mui-palette-primary-main)' }}
              >
                see docs
              </a>
              .
            </Typography>
          </div>

          {config?.firstStartedAt && (
            <div
              className='flex items-start gap-2.5 px-3 py-2 rounded-md'
              style={{
                backgroundColor: 'rgb(var(--mui-palette-warning-mainChannel) / 0.08)',
                border: '1px solid rgb(var(--mui-palette-warning-mainChannel) / 0.3)'
              }}
            >
              <i className='tabler-alert-triangle text-warning text-base shrink-0 mt-0.5' />
              <Typography variant='caption' sx={{ lineHeight: 1.6, color: 'text.primary' }}>
                Validator already started — <strong>party hint</strong> is locked. Other fields can still be updated, but changes require a restart.
              </Typography>
            </div>
          )}

          {error && (
            <Alert severity='error' onClose={onClearError} sx={{ py: 0.5 }}>
              <Typography variant='caption'>{error}</Typography>
            </Alert>
          )}

          <TextField
            label='Migration ID'
            type='number'
            value={form.migrationId}
            onChange={e => setForm(f => ({ ...f, migrationId: e.target.value }))}
            size='small'
            fullWidth
            required
            helperText={
              <span>
                Current migration ID for {validator?.network}. Find it on{' '}
                <a href='https://sync.global/sv-network/' target='_blank' rel='noopener noreferrer' style={{ color: 'var(--mui-palette-primary-main)' }}>
                  sync.global/sv-network
                </a>
              </span>
            }
          />

          <TextField
            label='Sponsor SV URL'
            value={form.sponsorSvUrl}
            onChange={e => setForm(f => ({ ...f, sponsorSvUrl: e.target.value }))}
            placeholder='https://sv.sv-1.dev.global.canton.network.sync.global'
            size='small'
            fullWidth
            required
          />

          <TextField
            label='Scan URL'
            value={form.scanUrl}
            onChange={e => setForm(f => ({ ...f, scanUrl: e.target.value }))}
            placeholder='https://scan.sv-1.dev.global.canton.network.digitalasset.com'
            size='small'
            fullWidth
            required
          />

          <TextField
            label='Sequencer URL'
            value={form.sequencerUrl}
            onChange={e => setForm(f => ({ ...f, sequencerUrl: e.target.value }))}
            placeholder='https://sequencer-1.sv-1.dev.global.canton.network.digitalasset.com:443'
            size='small'
            fullWidth
            required
          />

          <div>
            <TextField
              label={config?.hasOnboardingSecret ? 'Onboarding secret (already set — type to replace)' : 'Onboarding secret'}
              type='password'
              value={form.onboardingSecret}
              onChange={e => setForm(f => ({ ...f, onboardingSecret: e.target.value }))}
              size='small'
              fullWidth
              required={!config?.hasOnboardingSecret}
              helperText='One-time secret from your sponsor SV. Expires 48 hours after issue.'
            />
            {validator?.network === 'DevNet' && (
              <Button
                size='small'
                variant='text'
                onClick={onGenerateDevnetSecret}
                disabled={secretBusy || !form.sponsorSvUrl}
                startIcon={secretBusy ? <CircularProgress size={12} /> : <i className='tabler-bolt text-sm' />}
                sx={{ textTransform: 'none', mt: 0.5 }}
              >
                {secretBusy ? 'Requesting…' : 'Generate from sponsor SV'}
              </Button>
            )}
          </div>

          <TextField
            label='Party hint'
            value={form.partyHint}
            onChange={e => setForm(f => ({ ...f, partyHint: e.target.value }))}
            placeholder='myCompany-myWallet-1'
            size='small'
            fullWidth
            required
            disabled={!!config?.firstStartedAt}
            helperText='Format: <organization>-<function>-<enumerator>. Permanent after first start.'
          />

          <FormControlLabel
            control={
              <Checkbox
                size='small'
                checked={form.disableBft}
                onChange={e => setForm(f => ({ ...f, disableBft: e.target.checked }))}
              />
            }
            label={
              <Typography variant='caption' color='text.secondary'>
                Disable BFT mode (start.sh <code>-b</code>) — currently recommended
              </Typography>
            }
          />

          {/* Stage 6 — Auto Top-Up Traffic */}
          <div className='flex flex-col gap-2 rounded border border-divider p-3'>
            <FormControlLabel
              control={
                <Checkbox
                  size='small'
                  checked={form.autoTopUpEnabled}
                  onChange={e => setForm(f => ({ ...f, autoTopUpEnabled: e.target.checked }))}
                />
              }
              label={
                <Typography variant='caption' color='text.secondary'>
                  <strong>Auto Top-Up Traffic</strong> — automatically buy traffic from amulet balance when reservation runs low
                </Typography>
              }
            />
            <Alert severity={form.autoTopUpEnabled ? 'warning' : 'info'} sx={{ py: 0.5, '& .MuiAlert-message': { fontSize: '0.7rem', lineHeight: 1.5 } }}>
              {form.autoTopUpEnabled ? (
                <>⚠ Only enable this AFTER the wallet has received its first faucet tap and has amulets. Otherwise the validator will deadlock with HTTP 429 (cannot buy traffic without amulets).</>
              ) : (
                <>For first-time bootstrap leave this OFF — Nodepilot will set <code>TARGET_TRAFFIC_THROUGHPUT=0</code> so the validator can receive its faucet tap. Re-enable later once the operator wallet has amulets.</>
              )}
            </Alert>
            {form.autoTopUpEnabled && (
              <div className='flex gap-2 mt-1'>
                <TextField
                  label='Target throughput (bytes/sec)'
                  value={form.trafficThroughput}
                  onChange={e => setForm(f => ({ ...f, trafficThroughput: e.target.value.replace(/[^\d]/g, '') }))}
                  placeholder='200000'
                  size='small'
                  fullWidth
                  helperText='200000 = 200 KB/s (default for low traffic)'
                />
                <TextField
                  label='Min top-up interval'
                  value={form.trafficTopupInterval}
                  onChange={e => setForm(f => ({ ...f, trafficTopupInterval: e.target.value }))}
                  placeholder='1m'
                  size='small'
                  fullWidth
                  helperText='Duration: 30s, 1m, 10m'
                />
              </div>
            )}
          </div>
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
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
