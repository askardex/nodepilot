import { z } from 'zod'

const networkValues = ['DevNet', 'TestNet', 'MainNet'] as const

const hostValidator = z
  .string()
  .min(1)
  .max(255)
  .trim()
  .refine(
    val => {
      const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/
      const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/

      return ipRegex.test(val) || hostnameRegex.test(val)
    },
    { message: 'Must be a valid IP address or hostname (no protocol or path)' }
  )

const deploymentModeValues = ['compose', 'k8s'] as const
const clusterTypeValues = ['k3s', 'gke', 'eks', 'aks', 'doks', 'other'] as const

export const createValidatorSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  host: hostValidator,
  sshPort: z.number().int().min(1).max(65535).default(22),
  sshUsername: z.string().min(1).max(100).default('root'),
  sshAuthType: z.enum(['password', 'key']).default('password'),
  sshPassword: z.string().max(500).optional(),
  sshPrivateKey: z.string().max(10000).optional(),
  network: z.enum(networkValues).default('DevNet'),
  hostname: z.string().max(255).optional(),
  deploymentMode: z.enum(deploymentModeValues).default('compose'),
  // K8s fields (required when deploymentMode = 'k8s')
  clusterType: z.enum(clusterTypeValues).optional(),
  kubeconfig: z.string().max(50000).optional(),
  k8sNamespace: z.string().max(100).optional()
})

const statusValues = ['Online', 'Offline', 'Error', 'Unconfigured', 'Installing'] as const

export const updateValidatorSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  host: hostValidator,
  sshPort: z.number().int().min(1).max(65535),
  sshUsername: z.string().min(1).max(100),
  sshAuthType: z.enum(['password', 'key']),
  sshPassword: z.string().max(500).optional(),
  sshPrivateKey: z.string().max(10000).optional(),
  network: z.enum(networkValues),
  hostname: z.string().max(255).optional(),
  validatorPort: z.number().int().min(1).max(65535),
  partyId: z.string().max(500).optional(),
  synchronizerId: z.string().max(500).optional(),
  status: z.enum(statusValues)
}).partial()

export type CreateValidatorInput = z.infer<typeof createValidatorSchema>
export type UpdateValidatorInput = z.infer<typeof updateValidatorSchema>
