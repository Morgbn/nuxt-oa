import { createCipheriv, createDecipheriv } from 'node:crypto'
import type { CipherGCMTypes } from 'node:crypto'

/**
 * Encrypt data
 * @returns encrypted data
 */
export function encrypt (data: any, iv: string, key: Buffer, algorithm: CipherGCMTypes): string {
  if (data === null || typeof data === 'undefined') { return data }
  const isObj = typeof data === 'object'
  if (isObj) { data = JSON.stringify(data) }
  const cipher = createCipheriv(algorithm, key, Buffer.from(iv, 'base64'))
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
  return `${isObj ? 'o' : ''}$${encrypted.toString('base64')}$${cipher.getAuthTag().toString('base64')}`
}

/**
 * Decrypt data
 * @returns decrypted data
 */
export function decrypt (data: any, iv: string, key: Buffer, algorithm: CipherGCMTypes): string|undefined {
  if (typeof data !== 'string') { return data }
  const [isObj, encrypted, authTag] = data.split('$')
  if (!encrypted) { return undefined }
  const decipher = createDecipheriv(algorithm, key, Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(authTag, 'base64'))
  const cryptedBuffer = Buffer.from(encrypted, 'base64')
  const decrpyted = Buffer.concat([decipher.update(cryptedBuffer), decipher.final()])
  const text = decrpyted.toString()
  return isObj ? JSON.parse(text) : text
}
