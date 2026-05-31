'use client'

import { useState } from 'react'

import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Grid from '@mui/material/Grid'
import Alert from '@mui/material/Alert'
import Stepper from '@mui/material/Stepper'
import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import InputAdornment from '@mui/material/InputAdornment'
import IconButton from '@mui/material/IconButton'
import Chip from '@mui/material/Chip'
import Box from '@mui/material/Box'

type Props = {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

const networks = ['DevNet', 'TestNet', 'MainNet']
const steps = ['Server', 'Authentication', 'Test Connection']

type DeploymentMode = 'compose' | 'k8s'
type ClusterType = 'k3s' | 'gke' | 'eks' | 'aks' | 'doks' | 'other'

const clusterTypes: { value: ClusterType; label: string; icon: string }[] = [
  { value: 'k3s', label: 'k3s (VPS)', icon: 'tabler-server' },
  { value: 'gke', label: 'GKE', icon: 'tabler-brand-google' },
  { value: 'eks', label: 'EKS', icon: 'tabler-brand-aws' },
  { value: 'aks', label: 'AKS', icon: 'tabler-brand-azure' },
  { value: 'doks', label: 'DOKS', icon: 'tabler-droplet' },
  { value: 'other', label: 'Other', icon: 'tabler-cloud' }
]

export default function AddValidatorDialog({ open, onClose, onSuccess }: Props) {
  const [activeStep, setActiveStep] = useState(0)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; hostname?: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [form, setForm] = useState({
    name: '',
    host: '',
    sshPort: 22,
    network: 'DevNet',
    sshAuthType: 'password' as 'password' | 'key',
    sshUsername: 'root',
    sshPassword: '',
    sshPrivateKey: '',
    deploymentMode: 'compose' as DeploymentMode,
    clusterType: 'k3s' as ClusterType,
    kubeconfig: '',
    k8sNamespace: 'validator'
  })

  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = ['sshPort'].includes(field) ? Number(e.target.value) : e.target.value

    setForm(prev => ({ ...prev, [field]: value }))
    setTestResult(null)
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    setError('')

    try {
      const res = await fetch('/api/validators/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: form.host,
          port: form.sshPort,
          authType: form.sshAuthType,
          username: form.sshUsername,
          password: form.sshAuthType === 'password' ? form.sshPassword : undefined,
          privateKey: form.sshAuthType === 'key' ? form.sshPrivateKey : undefined
        })
      })

      const data = await res.json()

      if (!res.ok) {
        setTestResult({ success: false, message: data.error || 'Request failed' })
      } else {
        setTestResult(data)
      }
    } catch {
      setTestResult({ success: false, message: 'Network error' })
    } finally {
      setTesting(false)
    }
  }

  const handleAddValidator = async () => {
    setSaving(true)
    setError('')

    try {
      const res = await fetch('/api/validators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          host: form.host,
          sshPort: form.sshPort,
          sshUsername: form.sshUsername,
          sshAuthType: form.sshAuthType,
          sshPassword: form.sshAuthType === 'password' ? form.sshPassword : undefined,
          sshPrivateKey: form.sshAuthType === 'key' ? form.sshPrivateKey : undefined,
          network: form.network,
          hostname: testResult?.hostname || undefined,
          deploymentMode: form.deploymentMode,
          ...(form.deploymentMode === 'k8s' ? {
            clusterType: form.clusterType,
            kubeconfig: form.kubeconfig || undefined,
            k8sNamespace: form.k8sNamespace
          } : {})
        })
      })

      if (!res.ok) {
        const data = await res.json()

        setError(data.error || 'Failed to add validator')

        return
      }

      resetForm()
      onSuccess()
      onClose()
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  const resetForm = () => {
    setForm({ name: '', host: '', sshPort: 22, network: 'DevNet', sshAuthType: 'password', sshUsername: 'root', sshPassword: '', sshPrivateKey: '', deploymentMode: 'compose', clusterType: 'k3s', kubeconfig: '', k8sNamespace: 'validator' })
    setActiveStep(0)
    setTestResult(null)
    setError('')
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const canGoNext = () => {
    if (activeStep === 0) return form.name.length > 0 && form.host.length > 0
    if (activeStep === 1) {
      if (form.sshAuthType === 'password') return form.sshUsername.length > 0 && form.sshPassword.length > 0

      return form.sshUsername.length > 0 && form.sshPrivateKey.length > 0
    }

    return false
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth='sm' fullWidth>
      <DialogTitle className='flex items-center justify-between'>
        Add Validator
        <IconButton onClick={handleClose} size='small' disabled={saving}>
          <i className='tabler-x' />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stepper activeStep={activeStep} className='mbe-6 mbs-2'>
          {steps.map(label => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && (
          <Alert severity='error' className='mbe-4'>
            {error}
          </Alert>
        )}

        {/* Step 1: Server Info */}
        {activeStep === 0 && (
          <Grid container spacing={4}>
            <Grid size={{ xs: 12 }}>
              <TextField
                label='Validator Name'
                fullWidth
                required
                value={form.name}
                onChange={handleChange('name')}
                placeholder='e.g. Production DevNet'
                autoFocus
              />
            </Grid>
            <Grid size={{ xs: 8 }}>
              <TextField
                label='IP Address / Hostname'
                fullWidth
                required
                value={form.host}
                onChange={handleChange('host')}
                placeholder='0.0.0.0'
              />
            </Grid>
            <Grid size={{ xs: 4 }}>
              <TextField
                label='SSH Port'
                type='number'
                fullWidth
                value={form.sshPort}
                onChange={handleChange('sshPort')}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label='Network'
                select
                fullWidth
                value={form.network}
                onChange={handleChange('network')}
              >
                {networks.map(n => (
                  <MenuItem key={n} value={n}>
                    {n}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Typography variant='subtitle2' className='mbe-2'>Deployment Mode</Typography>
              <Box className='flex gap-3'>
                <Box
                  onClick={() => setForm(prev => ({ ...prev, deploymentMode: 'compose' }))}
                  className='flex-1 cursor-pointer rounded-lg border-2 p-4 transition-all'
                  sx={{
                    borderColor: form.deploymentMode === 'compose' ? 'primary.main' : 'divider',
                    bgcolor: form.deploymentMode === 'compose' ? 'primary.lighterOpacity' : 'transparent'
                  }}
                >
                  <Box className='flex items-center gap-2 mbe-1'>
                    <i className='tabler-brand-docker text-xl' />
                    <Typography variant='subtitle2'>Docker Compose</Typography>
                    <Chip label='Default' size='small' color='primary' variant='tonal' />
                  </Box>
                  <Typography variant='caption' color='text.secondary'>
                    SSH to VPS, docker compose up/down
                  </Typography>
                </Box>
                <Box
                  onClick={() => setForm(prev => ({ ...prev, deploymentMode: 'k8s' }))}
                  className='flex-1 cursor-pointer rounded-lg border-2 p-4 transition-all'
                  sx={{
                    borderColor: form.deploymentMode === 'k8s' ? 'primary.main' : 'divider',
                    bgcolor: form.deploymentMode === 'k8s' ? 'primary.lighterOpacity' : 'transparent'
                  }}
                >
                  <Box className='flex items-center gap-2 mbe-1'>
                    <i className='tabler-ship text-xl' />
                    <Typography variant='subtitle2'>Kubernetes</Typography>
                  </Box>
                  <Typography variant='caption' color='text.secondary'>
                    k3s on VPS or managed cluster, helm install
                  </Typography>
                </Box>
              </Box>
            </Grid>
            {form.deploymentMode === 'k8s' && (
              <>
                <Grid size={{ xs: 12 }}>
                  <Typography variant='subtitle2' className='mbe-2'>Cluster Type</Typography>
                  <Box className='flex flex-wrap gap-2'>
                    {clusterTypes.map(ct => (
                      <Chip
                        key={ct.value}
                        label={ct.label}
                        icon={<i className={ct.icon} />}
                        variant={form.clusterType === ct.value ? 'filled' : 'outlined'}
                        color={form.clusterType === ct.value ? 'primary' : 'default'}
                        onClick={() => setForm(prev => ({ ...prev, clusterType: ct.value }))}
                        sx={{ cursor: 'pointer' }}
                      />
                    ))}
                  </Box>
                  {form.clusterType === 'k3s' && (
                    <Typography variant='caption' color='text.secondary' className='mbs-1 block'>
                      k3s will be auto-installed on your VPS. No extra cost.
                    </Typography>
                  )}
                </Grid>
                {form.clusterType !== 'k3s' && (
                  <Grid size={{ xs: 12 }}>
                    <TextField
                      label='Kubeconfig'
                      fullWidth
                      multiline
                      rows={3}
                      value={form.kubeconfig}
                      onChange={handleChange('kubeconfig')}
                      placeholder='Paste kubeconfig YAML here'
                      size='small'
                    />
                  </Grid>
                )}
                <Grid size={{ xs: 12 }}>
                  <TextField
                    label='Namespace'
                    fullWidth
                    value={form.k8sNamespace}
                    onChange={handleChange('k8sNamespace')}
                    placeholder='validator'
                    size='small'
                  />
                </Grid>
              </>
            )}
          </Grid>
        )}

        {/* Step 2: Authentication */}
        {activeStep === 1 && (
          <Grid container spacing={4}>
            <Grid size={{ xs: 12 }}>
              <TextField
                label='Username'
                fullWidth
                required
                value={form.sshUsername}
                onChange={handleChange('sshUsername')}
                placeholder='root'
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label='Auth Method'
                select
                fullWidth
                value={form.sshAuthType}
                onChange={handleChange('sshAuthType')}
              >
                <MenuItem value='password'>Password</MenuItem>
                <MenuItem value='key'>SSH Private Key</MenuItem>
              </TextField>
            </Grid>
            {form.sshAuthType === 'password' ? (
              <Grid size={{ xs: 12 }}>
                <TextField
                  label='Password'
                  fullWidth
                  required
                  type={showPassword ? 'text' : 'password'}
                  value={form.sshPassword}
                  onChange={handleChange('sshPassword')}
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position='end'>
                          <IconButton onClick={() => setShowPassword(!showPassword)} edge='end' size='small'>
                            <i className={showPassword ? 'tabler-eye-off' : 'tabler-eye'} />
                          </IconButton>
                        </InputAdornment>
                      )
                    }
                  }}
                />
              </Grid>
            ) : (
              <Grid size={{ xs: 12 }}>
                <TextField
                  label='Private Key'
                  fullWidth
                  required
                  multiline
                  rows={6}
                  value={form.sshPrivateKey}
                  onChange={handleChange('sshPrivateKey')}
                  placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'}
                  sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.75rem' } }}
                />
              </Grid>
            )}
          </Grid>
        )}

        {/* Step 3: Test Connection */}
        {activeStep === 2 && (
          <div className='flex flex-col items-center gap-4 py-4'>
            <Typography variant='body1' color='text.secondary' className='text-center'>
              Test SSH connection to <strong>{form.host}:{form.sshPort}</strong> as <strong>{form.sshUsername}</strong>
            </Typography>

            {!testResult && !testing && (
              <Button
                variant='outlined'
                size='large'
                startIcon={<i className='tabler-plug-connected' />}
                onClick={handleTestConnection}
              >
                Test Connection
              </Button>
            )}

            {testing && (
              <div className='flex items-center gap-3'>
                <CircularProgress size={24} />
                <Typography>Connecting...</Typography>
              </div>
            )}

            {testResult && (
              <Alert
                severity={testResult.success ? 'success' : 'error'}
                className='w-full'
              >
                <div>
                  <Typography variant='body2' fontWeight={600}>
                    {testResult.message}
                  </Typography>
                  {testResult.hostname && (
                    <Typography variant='caption' color='text.secondary'>
                      Hostname: {testResult.hostname}
                    </Typography>
                  )}
                </div>
              </Alert>
            )}

            {testResult && !testResult.success && (
              <Button variant='text' size='small' onClick={handleTestConnection}>
                Retry
              </Button>
            )}
          </div>
        )}
      </DialogContent>
      <DialogActions>
        {activeStep > 0 && (
          <Button onClick={() => { setActiveStep(prev => prev - 1); setTestResult(null) }} disabled={saving}>
            Back
          </Button>
        )}
        {activeStep < 2 && (
          <Button variant='contained' onClick={() => setActiveStep(prev => prev + 1)} disabled={!canGoNext()}>
            Next
          </Button>
        )}
        {activeStep === 2 && testResult?.success && (
          <Button
            variant='contained'
            onClick={handleAddValidator}
            disabled={saving}
            startIcon={saving ? <CircularProgress size={16} /> : <i className='tabler-plus' />}
          >
            {saving ? 'Adding...' : 'Add Validator'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
