import type { CipherGCMTypes } from 'node:crypto'

export interface ModuleOptions {
  schemasFolder: string,
  dbUrl?: string,
  cipherAlgo: CipherGCMTypes,
  cipherKey?: string,
  openApiPath?: string,
  swaggerPath?: string,
}
