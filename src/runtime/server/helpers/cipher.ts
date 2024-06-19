/* eslint-disable @typescript-eslint/no-explicit-any */
import { createCipheriv, createDecipheriv } from 'node:crypto'
import type { CipherGCMTypes } from 'node:crypto'

/**
 * Encrypt data
 * @returns encrypted data
 */
export function encrypt(data: any, iv: string, key: Buffer, algorithm: CipherGCMTypes): string {
  if (data === null || typeof data === 'undefined') return data
  const isObj = typeof data === 'object'
  if (isObj) data = JSON.stringify(data)
  const ivBuffer = Buffer.from(iv, 'base64')
  let encrypted: Buffer | undefined
  let encryptedStr = ''
  try {
    const cipher = createCipheriv(algorithm, key, ivBuffer)
    encrypted = Buffer.concat([cipher.update(data), cipher.final()])
    encryptedStr = `${isObj ? 'o' : ''}$${encrypted.toString('base64')}$${cipher.getAuthTag().toString('base64')}`
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
export function decrypt(data: any, iv: string, key: Buffer, algorithm: CipherGCMTypes): string | Record<string, any> | undefined {
  if (typeof data !== 'string') return data
  const [isObj, encrypted, authTag] = data.split('$')
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
  return isObj && decryptedStr ? JSON.parse(decryptedStr) : decryptedStr
}
