import type { Metadata } from 'next'

import Register from '@views/Register'
import { getServerMode } from '@core/utils/serverHelpers'

export const metadata: Metadata = {
  title: 'Create Account',
  description: 'Setup your NodePilot admin account'
}

const RegisterPage = async () => {
  const mode = await getServerMode()

  return <Register mode={mode} />
}

export default RegisterPage
