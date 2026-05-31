'use client'

import { useState, useEffect, useCallback } from 'react'

import Grid from '@mui/material/Grid'
import Card from '@mui/material/Card'
import CardHeader from '@mui/material/CardHeader'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Button from '@mui/material/Button'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import Tooltip from '@mui/material/Tooltip'

import AddValidatorDialog from '@/components/validators/AddValidatorDialog'

type Validator = {
  id: string
  name: string
  host: string
  sshPort: number
  network: string
  deploymentMode: string
  validatorPort: number
  version: string | null
  hostname: string | null
  status: string
  uptime: string | null
  lastSyncAt: string | null
  lastHealthCheck: string | null
  createdAt: string
}

const statusColor: Record<string, 'success' | 'error' | 'warning' | 'default' | 'info'> = {
  Online: 'success',
  Offline: 'default',
  Error: 'error',
  Unconfigured: 'warning',
  Installing: 'info'
}

export default function ValidatorPage() {
  const [validators, setValidators] = useState<Validator[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [checkingHealth, setCheckingHealth] = useState<string | null>(null)

  const fetchValidators = useCallback(async () => {
    try {
      const res = await fetch('/api/validators')

      if (!res.ok) throw new Error('Failed to fetch')

      const data = await res.json()

      setValidators(data)
      setError('')
    } catch {
      setError('Failed to load validators')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchValidators()
  }, [fetchValidators])

  const handleHealthCheck = async (id: string) => {
    setCheckingHealth(id)

    try {
      const res = await fetch(`/api/validators/${id}/health`, { method: 'POST' })

      if (res.ok) {
        await fetchValidators()
      }
    } finally {
      setCheckingHealth(null)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete validator "${name}"? This cannot be undone.`)) return

    const res = await fetch(`/api/validators/${id}`, { method: 'DELETE' })

    if (res.ok) {
      await fetchValidators()
    }
  }

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '—'

    const date = new Date(dateStr)
    const now = new Date()
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000)

    if (diff < 60) return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`

    return date.toLocaleDateString()
  }

  if (loading) {
    return (
      <div className='flex justify-center items-center min-h-[400px]'>
        <CircularProgress />
      </div>
    )
  }

  return (
    <Grid container spacing={6}>
      {/* Header */}
      <Grid size={{ xs: 12 }}>
        <div className='flex items-center justify-between'>
          <div>
            <Typography variant='h4'>Validators</Typography>
            <Typography variant='body2' color='text.secondary'>
              Manage and monitor your Canton Network validators
            </Typography>
          </div>
          <Button variant='contained' startIcon={<i className='tabler-plus' />} onClick={() => setDialogOpen(true)}>
            Add Validator
          </Button>
        </div>
      </Grid>

      {error && (
        <Grid size={{ xs: 12 }}>
          <Alert severity='error'>{error}</Alert>
        </Grid>
      )}

      {/* Validator Table */}
      <Grid size={{ xs: 12 }}>
        <Card>
          <CardHeader
            title='All Validators'
            subheader={`${validators.length} validator${validators.length !== 1 ? 's' : ''} registered`}
            action={
              <Button size='small' startIcon={<i className='tabler-refresh' />} onClick={fetchValidators}>
                Refresh
              </Button>
            }
          />
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Host</TableCell>
                  <TableCell>Network</TableCell>
                  <TableCell>Mode</TableCell>
                  <TableCell>Version</TableCell>
                  <TableCell>Last Check</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align='center'>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {validators.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} align='center'>
                      <Typography variant='body2' color='text.secondary' className='py-8'>
                        No validators yet. Click &quot;Add Validator&quot; to get started.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  validators.map(v => (
                    <TableRow key={v.id} hover>
                      <TableCell>
                        <div
                          className='cursor-pointer'
                          onClick={() => window.location.href = `/validator/${v.id}`}
                        >
                          <Typography variant='body2' fontWeight={600} color='primary' sx={{ '&:hover': { textDecoration: 'underline' } }}>
                            {v.name}
                          </Typography>
                          <Typography variant='caption' color='text.secondary'>
                            {v.hostname || v.host}
                          </Typography>
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className='text-sm'>
                          {v.host}
                        </code>
                      </TableCell>
                      <TableCell>
                        <Chip label={v.network} size='small' variant='outlined' />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={v.deploymentMode === 'k8s' ? 'K8s' : 'Compose'}
                          size='small'
                          variant='tonal'
                          color={v.deploymentMode === 'k8s' ? 'info' : 'secondary'}
                        />
                      </TableCell>
                      <TableCell>{v.version || '—'}</TableCell>
                      <TableCell>{formatTime(v.lastHealthCheck)}</TableCell>
                      <TableCell>
                        <Chip label={v.status} size='small' color={statusColor[v.status] || 'default'} />
                      </TableCell>
                      <TableCell align='center'>
                        <Tooltip title='Health Check'>
                          <span>
                            <IconButton
                              size='small'
                              onClick={() => handleHealthCheck(v.id)}
                              disabled={checkingHealth === v.id}
                            >
                              {checkingHealth === v.id ? (
                                <CircularProgress size={18} />
                              ) : (
                                <i className='tabler-heartbeat text-lg' />
                              )}
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title='Delete'>
                          <IconButton size='small' onClick={() => handleDelete(v.id, v.name)} color='error'>
                            <i className='tabler-trash text-lg' />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      </Grid>

      {/* Add Validator Dialog */}
      <AddValidatorDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSuccess={fetchValidators} />
    </Grid>
  )
}
