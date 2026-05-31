// MUI Imports
import Grid from '@mui/material/Grid'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'

// Mock data
const stats = [
  { title: 'Total Validators', value: '4', icon: 'tabler-server', color: 'primary' },
  { title: 'Online', value: '2', icon: 'tabler-circle-check', color: 'success' },
  { title: 'Offline', value: '1', icon: 'tabler-circle-x', color: 'secondary' },
  { title: 'Errors', value: '1', icon: 'tabler-alert-triangle', color: 'error' }
]

const validators = [
  { id: 'qvv1DgOqFa05', name: 'Production DevNet', host: '0.0.0.0', network: 'DevNet', status: 'Online', version: '0.6.2' },
  { id: 'abc123xyz890', name: 'Staging TestNet', host: '203.0.113.10', network: 'TestNet', status: 'Online', version: '0.6.1' },
  { id: 'main888valid', name: 'Mainnet Primary', host: '10.0.0.5', network: 'MainNet', status: 'Error', version: '0.6.0' },
  { id: 'newinstall01', name: 'New Validator', host: '192.168.1.100', network: 'DevNet', status: 'Installing', version: '—' }
]

const statusColor: Record<string, 'success' | 'error' | 'warning' | 'default' | 'info'> = {
  Online: 'success',
  Offline: 'default',
  Error: 'error',
  Installing: 'warning'
}

export default function Page() {
  return (
    <Grid container spacing={6}>
      {/* Stat Cards */}
      {stats.map(stat => (
        <Grid key={stat.title} size={{ xs: 12, sm: 6, lg: 3 }}>
          <Card>
            <CardContent className='flex items-center gap-4'>
              <div className={`flex items-center justify-center rounded-lg p-2 bg-${stat.color}Light`}>
                <i className={`${stat.icon} text-2xl text-${stat.color}`} />
              </div>
              <div>
                <Typography variant='h4'>{stat.value}</Typography>
                <Typography variant='body2' color='text.secondary'>
                  {stat.title}
                </Typography>
              </div>
            </CardContent>
          </Card>
        </Grid>
      ))}

      {/* Validators Table */}
      <Grid size={{ xs: 12 }}>
        <Card>
          <CardContent>
            <Typography variant='h5' className='mbe-4'>
              Validators
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Host</TableCell>
                    <TableCell>Network</TableCell>
                    <TableCell>Version</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {validators.map(v => (
                    <TableRow key={v.id} hover>
                      <TableCell>
                        <Typography variant='body2' fontWeight={500}>
                          {v.name}
                        </Typography>
                        <Typography variant='caption' color='text.secondary'>
                          {v.id}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant='body2' fontFamily='monospace'>
                          {v.host}
                        </Typography>
                      </TableCell>
                      <TableCell>{v.network}</TableCell>
                      <TableCell>{v.version}</TableCell>
                      <TableCell>
                        <Chip label={v.status} color={statusColor[v.status]} size='small' variant='tonal' />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  )
}
