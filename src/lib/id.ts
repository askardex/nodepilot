import { randomBytes } from 'crypto'

export function generateValidatorId(): string {
  const hex = randomBytes(4).toString('hex').toUpperCase()

  return `VAL-${hex}`
}
