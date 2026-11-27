import type { CipherGCMTypes } from 'node:crypto'
import type { MongoClientOptions } from 'mongodb'
import type { JSONSchema7 } from 'json-schema'

// API General Info: https://swagger.io/docs/specification/api-general-info/
export interface OpenApiGeneralInfo {
  title?: string
  version?: string
  description?: string
  termsOfService?: string
  contact?: {
    name?: string
    email?: string
    url?: string
  }
  license?: {
    name?: string
    url?: string
  }
  externalDocs?: {
    description?: string
    url?: string
  }
}

// API Server: https://swagger.io/docs/specification/api-host-and-base-path/
export interface OpenApiServer {
  url: string
  description?: string
  variables?: Record<string, {
    default: string
    enum?: string[]
    description?: string
  }>
}

export interface ModuleOptions {
  schemasFolder: string
  dbUrl: string
  dbOptions?: MongoClientOptions
  cipherAlgo: CipherGCMTypes
  cipherIvSize: number
  cipherKey: string
  openApiPath: string
  openApiGeneralInfo?: OpenApiGeneralInfo
  openApiServers?: OpenApiServer[]
  scalarPath: string
  /** See: https://scalar.com/products/api-references/configuration */
  scalarConfiguration?: Record<string, unknown>
  dbClientOnRenderer?: boolean
  /** Max number of items accepted by a bulk* endpoint, unless overridden per-model via the schema's `maxBulkSize` */
  maxBulkSize: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Schema = { [key: string]: any }

export type OaTimestamps = { createdAt?: boolean, updatedAt?: boolean, deletedAt?: boolean }
export type OaUserstamps = { createdBy?: boolean, updatedBy?: boolean, deletedBy?: boolean }

/** JSON Schema draft-07 + nuxt-oa keywords */
export type OaSchema = JSONSchema7 & {
  /** OpenAPI 3.0: also accepts `null` */
  nullable?: boolean
  encryptedProperties?: string[]
  /** `true` = track all (except readOnly props) */
  trackedProperties?: string[] | true
  timestamps?: OaTimestamps | boolean
  userstamps?: OaUserstamps | boolean
  /** Overrides module's `maxBulkSize` */
  maxBulkSize?: number
}

export type DefsSchema = { $id: string, definitions: Record<string, OaSchema> }

declare module '@nuxt/schema' {
  interface NuxtOptions {
    oa: Partial<ModuleOptions>
  }
  interface RuntimeConfig {
    oa: Partial<ModuleOptions>
  }
}
