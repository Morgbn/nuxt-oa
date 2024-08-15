import { createCipheriv, createDecipheriv } from 'node:crypto'
import type { CipherGCMTypes } from 'node:crypto'

type TypeCode = '' | 'n' | 'bi' | 'b' | 's' | 'o' | 'f'

/**
 * Encrypt data
 * @returns encrypted data
 */
export function encrypt(data: unknown, iv: string, key: Buffer, algorithm: CipherGCMTypes) {
  if (data === null || typeof data === 'undefined') return data
  const type = typeof data
  if (type != 'string') data = JSON.stringify(data)
  const typeCode = type === 'bigint' ? 'bi' : type === 'string' ? '' : type.slice(0, 1) as TypeCode
  const ivBuffer = Buffer.from(iv, 'base64')
  let encrypted: Buffer | undefined
  let encryptedStr = ''
  try {
    const cipher = createCipheriv(algorithm, key, ivBuffer)
    encrypted = Buffer.concat([cipher.update(data as string), cipher.final()])
    encryptedStr = `${typeCode}$${encrypted.toString('base64')}$${cipher.getAuthTag().toString('base64')}`
  } finally { // erase sensitive data
    ivBuffer.fill(0)
    if (Buffer.isBuffer(encrypted)) encrypted.fill(0)
  }
  return encryptedStr
}

/**
 * Decrypt data
 * @returns decrypted data
 */
export function decrypt(data: string | undefined | null, iv: string, key: Buffer, algorithm: CipherGCMTypes) {
  if (typeof data !== 'string') return data
  const [type, encrypted, authTag] = data.split('$') as [TypeCode, string, string]
  if (!encrypted) return undefined
  const ivBuffer = Buffer.from(iv, 'base64')
  const authTagBuffer = Buffer.from(authTag, 'base64')
  const encryptedBuffer = Buffer.from(encrypted, 'base64')
  let decrypted: Buffer | undefined
  let decryptedStr: string | undefined = undefined
  try {
    const decipher = createDecipheriv(algorithm, key, ivBuffer)
    decipher.setAuthTag(authTagBuffer)
    decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()])
    decryptedStr = decrypted.toString()
  } finally { // erase sensitive data
    ivBuffer.fill(0)
    authTagBuffer.fill(0)
    encryptedBuffer.fill(0)
    if (Buffer.isBuffer(decrypted)) decrypted.fill(0)
  }
  if (!decryptedStr) return undefined
  if (type === 'o') return JSON.parse(decryptedStr) as Record<string, unknown>
  if (type === 'b') return JSON.parse(decryptedStr) as boolean
  if (type === 'n') return Number(decryptedStr)
  // don't support bigint/symbol/function
  return decryptedStr
}
