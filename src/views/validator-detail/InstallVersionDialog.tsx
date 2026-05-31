'use client'

import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

import type { Installation, InstallStep, Release } from './types'

export type InstallVersionDialogProps = {
  open: boolean
  installing: boolean
  installVersion: string
  installCustomUrl: string
  installSteps: InstallStep[]
  installLog: string
  showLog: boolean
  releases: Release[]
  releasesLoading: boolean
  releasesError: string | null
  installations: Installation[]
  installationsLoading: boolean
  busyVersion: string | null
  onClose: () => void
  onChangeVersion: (v: string) => void
  onChangeCustomUrl: (v: string) => void
  onInstall: () => void
  onFetchReleases: () => void
  onActivate: (version: string) => void
  onUninstall: (version: string) => void
  onToggleLog: () => void
}

export function InstallVersionDialog({
  open, installing, installVersion, installCustomUrl, installSteps, installLog, showLog,
  releases, releasesLoading, releasesError, installations, installationsLoading, busyVersion,
  onClose, onChangeVersion, onChangeCustomUrl, onInstall, onFetchReleases,
  onActivate, onUninstall, onToggleLog
}: InstallVersionDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={() => !installing && onClose()}
      maxWidth='sm'
      fullWidth
      PaperProps={{ sx: { maxInlineSize: 520 } }}
    >
      <DialogTitle className='flex items-center gap-2'>
        <i className='tabler-package text-primary' />
        Canton Installation
      </DialogTitle>
      {installing && <LinearProgress />}
      <DialogContent
        dividers
        className='custom-scroll'
        sx={{ minHeight: 200, maxHeight: 'calc(100vh - 240px)', p: installSteps.length > 0 ? 0 : undefined }}
      >
        {!installing && installSteps.length === 0 && (
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
                Each version installs to its own directory{' '}
                <code className='px-1 py-0.5 rounded' style={{ backgroundColor: 'rgb(var(--mui-palette-primary-mainChannel) / 0.08)', color: 'var(--mui-palette-primary-main)', fontSize: '0.75em' }}>
                  /root/splice-nodes/v&lt;version&gt;
                </code>
                .
              </Typography>
            </div>

            {(installations.length > 0 || installationsLoading) && (
              <div
                className='rounded-md overflow-hidden'
                style={{ border: '1px solid var(--mui-palette-divider)' }}
              >
                <div
                  className='flex items-center justify-between px-3 py-2'
                  style={{ borderBlockEnd: '1px solid var(--mui-palette-divider)', backgroundColor: 'rgb(var(--mui-palette-action-selectedChannel) / 0.04)' }}
                >
                  <Typography variant='caption' fontWeight={600} color='text.secondary' sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Installed on host
                  </Typography>
                  <Typography variant='caption' color='text.secondary'>
                    {installations.length} {installations.length === 1 ? 'version' : 'versions'}
                  </Typography>
                </div>

                {installationsLoading && installations.length === 0 ? (
                  <div className='px-3 py-3 flex items-center gap-2'>
                    <CircularProgress size={14} />
                    <Typography variant='caption' color='text.secondary'>Loading…</Typography>
                  </div>
                ) : (
                  installations.map((inst, i) => (
                    <div
                      key={inst.id}
                      className='flex items-center gap-2 px-3 py-2'
                      style={{ borderBlockEnd: i < installations.length - 1 ? '1px solid var(--mui-palette-divider)' : 'none' }}
                    >
                      <i
                        className={inst.isActive ? 'tabler-circle-check-filled text-success text-base' : 'tabler-circle text-textDisabled text-base'}
                      />
                      <div className='flex-1 min-w-0'>
                        <div className='flex items-center gap-2'>
                          <Typography variant='body2' fontWeight={600}>v{inst.version}</Typography>
                          {inst.isActive && (
                            <Chip
                              size='small'
                              label='Active'
                              color='success'
                              sx={{ blockSize: 18, fontSize: '0.65rem', '& .MuiChip-label': { paddingInline: 0.75 } }}
                            />
                          )}
                        </div>
                        <Typography variant='caption' color='text.secondary' className='block truncate'>
                          <code className='text-xs'>{inst.installPath}</code>
                        </Typography>
                      </div>
                      {!inst.isActive && (
                        <Tooltip title='Use this version for docker compose' arrow>
                          <span>
                            <Button
                              size='small'
                              variant='text'
                              disabled={busyVersion !== null}
                              onClick={() => onActivate(inst.version)}
                              startIcon={busyVersion === inst.version ? <CircularProgress size={12} /> : <i className='tabler-player-play text-sm' />}
                              sx={{ textTransform: 'none', fontSize: '0.75rem', minInlineSize: 'auto' }}
                            >
                              Activate
                            </Button>
                          </span>
                        </Tooltip>
                      )}
                      <Tooltip title={inst.isActive ? 'Cannot uninstall the active version directly. Activate another first.' : 'Remove this version from the host'} arrow>
                        <span>
                          <IconButton
                            size='small'
                            disabled={busyVersion !== null || (inst.isActive && installations.length > 1)}
                            onClick={() => onUninstall(inst.version)}
                          >
                            {busyVersion === inst.version
                              ? <CircularProgress size={14} />
                              : <i className='tabler-trash text-sm text-error' />}
                          </IconButton>
                        </span>
                      </Tooltip>
                    </div>
                  ))
                )}
              </div>
            )}

            {installVersion && installations.some(i => i.version === installVersion) && (
              <div
                className='flex items-start gap-2.5 px-3 py-2 rounded-md'
                style={{
                  backgroundColor: 'rgb(var(--mui-palette-warning-mainChannel) / 0.08)',
                  border: '1px solid rgb(var(--mui-palette-warning-mainChannel) / 0.3)'
                }}
              >
                <i className='tabler-alert-triangle text-warning text-base shrink-0 mt-0.5' />
                <Typography variant='caption' sx={{ lineHeight: 1.6, color: 'text.primary' }}>
                  <strong>v{installVersion}</strong> is already installed. Re-running will overwrite{' '}
                  <code className='px-1 rounded' style={{ backgroundColor: 'rgb(var(--mui-palette-warning-mainChannel) / 0.12)', fontSize: '0.85em' }}>
                    /root/splice-nodes/v{installVersion}
                  </code>
                  .
                </Typography>
              </div>
            )}

            <TextField
              select
              label={installations.length > 0 ? 'Install another version' : 'Splice version'}
              value={installVersion}
              onChange={e => onChangeVersion(e.target.value)}
              size='small'
              fullWidth
              disabled={releasesLoading || releases.length === 0}
              helperText={
                releasesLoading
                  ? 'Loading latest releases from GitHub…'
                  : releasesError
                    ? `Error: ${releasesError}`
                    : releases.length > 0
                      ? 'Latest 4 releases from digital-asset/decentralized-canton-sync'
                      : 'No releases available'
              }
              error={!!releasesError}
              SelectProps={{
                renderValue: value => {
                  const r = releases.find(rel => rel.version === value)

                  return r ? `${r.version}${r.prerelease ? ' · prerelease' : ''}` : (value as string)
                }
              }}
            >
              {releases.map(r => (
                <MenuItem key={r.tag} value={r.version}>
                  <div className='flex items-center justify-between gap-3 w-full'>
                    <div className='flex flex-col'>
                      <div className='flex items-center gap-2'>
                        <Typography variant='body2' fontWeight={600}>{r.version}</Typography>
                        {r.prerelease && (
                          <Typography variant='caption' color='warning.main' fontWeight={500}>
                            prerelease
                          </Typography>
                        )}
                      </div>
                      <Typography variant='caption' color='text.secondary'>
                        {new Date(r.publishedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                      </Typography>
                    </div>
                  </div>
                </MenuItem>
              ))}
            </TextField>

            {releasesError && (
              <Button size='small' onClick={onFetchReleases} startIcon={<i className='tabler-refresh' />} sx={{ alignSelf: 'flex-start' }}>
                Retry
              </Button>
            )}

            <TextField
              label='Custom tarball URL (optional)'
              placeholder='https://github.com/.../releases/download/v0.5.17/0.5.17_splice-node.tar.gz'
              value={installCustomUrl}
              onChange={e => onChangeCustomUrl(e.target.value)}
              size='small'
              fullWidth
              helperText='Override the download URL if the default tarball pattern is unavailable'
            />
          </div>
        )}

        {(installing || installSteps.length > 0) && (() => {
          const failed = installSteps.filter(s => s.status === 'error').length
          const succeeded = installSteps.filter(s => s.status === 'success').length
          const total = installSteps.length

          return (
            <>
              <div
                className='sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 border-b border-divider'
                style={{ backgroundColor: 'var(--mui-palette-background-paper)' }}
              >
                <div className='flex items-center gap-1.5'>
                  {installing ? (
                    <>
                      <CircularProgress size={14} />
                      <Typography variant='body2' fontWeight={600}>Installing…</Typography>
                    </>
                  ) : failed > 0 ? (
                    <>
                      <i className='tabler-circle-x text-error text-lg' />
                      <Typography variant='body2' fontWeight={600} color='error.main'>
                        Installation failed
                      </Typography>
                    </>
                  ) : (
                    <>
                      <i className='tabler-circle-check text-success text-lg' />
                      <Typography variant='body2' fontWeight={600} color='success.main'>
                        Installation complete
                      </Typography>
                    </>
                  )}
                </div>
                <Typography variant='caption' color='text.secondary'>
                  {succeeded}/{total} {failed > 0 ? `· ${failed} failed` : ''}
                </Typography>
              </div>

              <div className='flex flex-col px-4 pb-2 pt-1'>
                {installSteps.map((s, i) => {
                  const isRunningDownload =
                    s.status === 'running' &&
                    s.step.toLowerCase().startsWith('download') &&
                    typeof s.progress === 'number'

                  return (
                    <div
                      key={`${s.step}-${i}`}
                      className={i < installSteps.length - 1 ? 'border-b border-divider' : ''}
                      style={{ animation: 'checkSlideIn 0.3s ease-out forwards', animationDelay: `${i * 25}ms`, opacity: 0 }}
                    >
                      <div className='flex items-center justify-between py-2.5'>
                        <div className='flex items-center gap-2 min-w-0'>
                          {s.status === 'running' && <CircularProgress size={14} className='shrink-0' />}
                          {s.status === 'success' && <i className='tabler-circle-check text-success text-base shrink-0' />}
                          {s.status === 'error' && <i className='tabler-circle-x text-error text-base shrink-0' />}
                          {s.status === 'pending' && <i className='tabler-circle text-textDisabled text-base shrink-0' />}
                          <Typography variant='body2' className='truncate'>{s.step}</Typography>
                        </div>
                        {s.message && (
                          <Typography variant='body2' color='text.secondary' className='shrink-0 ml-3 truncate' sx={{ maxInlineSize: 200 }}>
                            <code className='text-xs'>{s.message}</code>
                          </Typography>
                        )}
                      </div>

                      {isRunningDownload && (
                        <div className='pb-2.5 -mt-1'>
                          <LinearProgress
                            variant='determinate'
                            value={s.progress}
                            sx={{
                              blockSize: 4,
                              borderRadius: 2,
                              backgroundColor: 'rgb(var(--mui-palette-primary-mainChannel) / 0.12)',
                              '& .MuiLinearProgress-bar': { borderRadius: 2 }
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {installLog && (
                <div className='px-4 pb-3 pt-1 border-t border-divider'>
                  <Button
                    size='small'
                    variant='text'
                    onClick={onToggleLog}
                    startIcon={<i className={showLog ? 'tabler-chevron-down' : 'tabler-chevron-right'} />}
                    sx={{ textTransform: 'none', color: 'text.secondary', fontSize: '0.75rem' }}
                  >
                    {showLog ? 'Hide raw log' : 'Show raw log'}
                  </Button>

                  {showLog && (
                    <pre
                      className='custom-scroll p-3 rounded-md text-xs font-mono mt-2'
                      style={{
                        margin: 0,
                        maxBlockSize: 240,
                        overflow: 'auto',
                        background: 'rgb(var(--mui-palette-action-selectedChannel) / 0.06)',
                        color: 'var(--mui-palette-text-secondary)',
                        border: '1px solid var(--mui-palette-divider)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        lineHeight: 1.6
                      }}
                      ref={el => { if (el) el.scrollTop = el.scrollHeight }}
                    >
                      {installLog}
                    </pre>
                  )}
                </div>
              )}
            </>
          )
        })()}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={installing}>
          Close
        </Button>
        {!installing && installSteps.length === 0 && (
          <Button
            variant='contained'
            startIcon={<i className='tabler-download' />}
            onClick={onInstall}
            disabled={!installVersion || releasesLoading}
          >
            Install
          </Button>
        )}
        {!installing && installSteps.length > 0 && (
          <Button
            variant='outlined'
            startIcon={<i className='tabler-refresh' />}
            onClick={onInstall}
          >
            Re-install
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
