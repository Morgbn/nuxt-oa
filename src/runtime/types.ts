import type { CipherGCMTypes } from 'node:crypto'
import type { MongoClientOptions, ObjectId } from 'mongodb'

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
  schemasFolder: string,
  dbUrl?: string
  dbOptions?: MongoClientOptions
  cipherAlgo: CipherGCMTypes
  cipherKey?: string
  openApiPath?: string
  openApiGeneralInfo?: OpenApiGeneralInfo
  openApiServers?: OpenApiServer[]
  swaggerPath?: string
}

export type Schema = { [key: string]: any }

export type DefsSchema = { $id: string, definitions: Record<string, Schema> }

export interface OaModels {
  [key: string]: Schema & { _id?: ObjectId, createdAt?: string|Date, updatedAt?: string|Date, createdBy?: string|ObjectId, updatedBy?: string|ObjectId, updates?: any[] }
}
