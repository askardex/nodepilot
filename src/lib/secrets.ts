import crypto from 'crypto'

const SECRET_PREFIX = 'enc:v1:'

function getEncryptionKey(): Buffer {
  const raw = process.env.SECRET_ENCRYPTION_KEY || process.env.AUTH_SECRET

  if (!raw) {
    throw new Error('Missing SECRET_ENCRYPTION_KEY or AUTH_SECRET for secret encryption')
  }

  return crypto.createHash('sha256').update(raw).digest()
}

export function isEncryptedSecret(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(SECRET_PREFIX)
}

export function encryptSecret(value: string): string {
  if (isEncryptedSecret(value)) return value
  if (!value) return value

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${SECRET_PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`
}

export function decryptSecret(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return value ?? null
  if (!isEncryptedSecret(value)) return value

  const payload = value.slice(SECRET_PREFIX.length)
  const [ivB64, tagB64, ciphertextB64] = payload.split('.')

  if (!ivB64 || !tagB64 || !ciphertextB64) {
    throw new Error('Invalid encrypted secret format')
  }

  const iv = Buffer.from(ivB64, 'base64url')
  const tag = Buffer.from(tagB64, 'base64url')
  const ciphertext = Buffer.from(ciphertextB64, 'base64url')
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv)

  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
