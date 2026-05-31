'use client'

import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

import RollerLoader from '@/components/blockchain-loader/RollerLoader'

export type SystemCheck = { name: string; value: string; status: string }

export type SystemCheckDialogProps = {
  open: boolean
  checking: boolean
  checks: SystemCheck[]
  history: SystemCheck[]
  installingPkg: string | null
  onClose: () => void
  onRerun: () => void
  onInstallPackage: (name: string) => void | Promise<void>
}

const INSTALLABLE = ['jq', 'curl', 'tar', 'k3s / kubectl', 'Helm', 'k3s Service', 'Traefik Ingress', 'cert-manager']

export function SystemCheckDialog({
  open, checking, checks, history, installingPkg, onClose, onRerun, onInstallPackage
}: SystemCheckDialogProps) {
  const passed = checks.filter(c => c.status === 'pass').length
  const failed = checks.filter(c => c.status === 'fail').length
  const warned = checks.filter(c => c.status === 'warn').length

  const pendingInstalls = checks.filter(c =>
    INSTALLABLE.includes(c.name) &&
    (c.value.includes('NOT_INSTALLED') || c.status === 'warn' || c.status === 'fail')
  )

  const handleInstallAll = async () => {
    for (const c of pendingInstalls) {
      // Sequential — each call streams SSE until done
      // eslint-disable-next-line no-await-in-loop
      await onInstallPackage(c.name)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => !checking && onClose()}
      maxWidth='sm'
      fullWidth
    >
      <DialogTitle className='flex items-center gap-2'>
        <i className='tabler-cpu text-primary' />
        System Check
      </DialogTitle>
      {checking && <LinearProgress />}
      <DialogContent
        dividers
        className='custom-scroll'
        sx={{ minHeight: 200, maxHeight: 'calc(100vh - 240px)', p: 0 }}
      >
        {checking && (
          <div className='p-4'>
            <RollerLoader label='Connecting to validator via SSH...' history={history} />
          </div>
        )}

        {!checking && checks.length > 0 && (
          <>
            <div
              className='sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-divider'
              style={{ backgroundColor: 'var(--mui-palette-background-paper)' }}
            >
              <div className='flex items-center gap-1.5'>
                <i className='tabler-circle-check text-success text-lg' />
                <Typography variant='body2' fontWeight={600}>{passed}</Typography>
              </div>
              {warned > 0 && (
                <div className='flex items-center gap-1.5'>
                  <i className='tabler-alert-triangle text-warning text-lg' />
                  <Typography variant='body2' fontWeight={600}>{warned}</Typography>
                </div>
              )}
              {failed > 0 && (
                <div className='flex items-center gap-1.5'>
                  <i className='tabler-circle-x text-error text-lg' />
                  <Typography variant='body2' fontWeight={600}>{failed}</Typography>
                </div>
              )}
              <Typography variant='caption' color='text.secondary' className='ml-auto'>
                {checks.length} checks
              </Typography>
            </div>

            <div className='flex flex-col px-4 pb-2'>
              {checks.map((check, i) => {
                const isSubItem = check.name.startsWith('↳')
                const installable = INSTALLABLE.includes(check.name)
                const needsInstall = installable && (check.value.includes('NOT_INSTALLED') || check.status === 'warn' || check.status === 'fail')

                return (
                  <div
                    key={`${check.name}-${i}`}
                    className={`flex items-center justify-between gap-2 py-2.5 ${isSubItem ? 'pl-6' : ''} ${i < checks.length - 1 ? 'border-b border-divider' : ''}`}
                    style={{ animation: 'checkSlideIn 0.3s ease-out forwards', animationDelay: `${i * 25}ms`, opacity: 0 }}
                  >
                    <div className='flex items-center gap-2 min-w-0'>
                      <i className={`text-base shrink-0 ${
                        check.status === 'pass' ? 'tabler-circle-check text-success' :
                          check.status === 'fail' ? 'tabler-circle-x text-error' :
                            check.status === 'warn' ? 'tabler-alert-triangle text-warning' :
                              'tabler-info-circle text-info'
                      }`} />
                      <Typography variant='body2' fontSize={isSubItem ? '0.8rem' : undefined} className='truncate'>
                        {isSubItem ? check.name.slice(2) : check.name}
                      </Typography>
                    </div>
                    <div className='flex items-center gap-2 shrink-0 ml-3' style={{ minInlineSize: 0, maxInlineSize: '55%' }}>
                      <Tooltip title={check.value} placement='top' arrow>
                        <Typography
                          variant='body2'
                          color='text.secondary'
                          className='truncate'
                          sx={{ minInlineSize: 0 }}
                        >
                          <code className='text-xs'>{check.value}</code>
                        </Typography>
                      </Tooltip>
                      {needsInstall && (
                        <Button
                          size='small'
                          variant='outlined'
                          disabled={installingPkg !== null}
                          onClick={() => onInstallPackage(check.name)}
                          startIcon={installingPkg === check.name ? <CircularProgress size={12} /> : <i className='tabler-download text-sm' />}
                          sx={{ textTransform: 'none', py: 0.25, px: 1, fontSize: '0.7rem', minInlineSize: 'auto' }}
                        >
                          {installingPkg === check.name ? 'Installing…' : 'Install'}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={checking}>Close</Button>
        {pendingInstalls.length > 0 && (
          <Button
            variant='contained'
            size='small'
            color='primary'
            startIcon={installingPkg !== null ? <CircularProgress size={14} /> : <i className='tabler-download' />}
            onClick={handleInstallAll}
            disabled={checking || installingPkg !== null}
          >
            {installingPkg !== null
              ? `Installing ${installingPkg}…`
              : `Install All (${pendingInstalls.length})`}
          </Button>
        )}
        <Button
          variant='outlined'
          size='small'
          startIcon={checking ? <CircularProgress size={14} /> : <i className='tabler-refresh' />}
          onClick={onRerun}
          disabled={checking || installingPkg !== null}
        >
          Re-run
        </Button>
      </DialogActions>
    </Dialog>
  )
}
