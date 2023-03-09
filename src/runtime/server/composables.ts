import { MongoClient, ObjectId } from 'mongodb'
import consola from 'consola'
import type { Db, Collection } from 'mongodb'
import type { H3Event } from 'h3'

import Model from './helpers/model'
export { createOaRouter, oaHandler, oaComponent } from './helpers/router'
export { useGetAll, useCreate, useUpdate, useArchive, useDelete } from './helpers/controllers'

const config = useRuntimeConfig().oa

const client = new MongoClient(config.dbUrl)
client.connect()
  .then(() => {
    consola.success('Connected Successfully to MongoDB')
  })
  .catch((err: any) => {
    consola.error(`DB Connection Error: ${err.message}`)
    process.exit(1)
  })
const dbName = new URL(config.dbUrl).pathname.split('/').pop() ?? 'test'
const db = client.db(dbName)

export function useDb (name?: string): Db {
  return client.db(name ?? dbName)
}

export function useCol (name: string, aDb?: Db): Collection {
  return (aDb ?? db).collection(name)
}

export function useObjectId (id: number | string | ObjectId | Buffer): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad id' })
  }
  return new ObjectId(id)
}

const modelsCache: Record<string, Model> = {}
export function useModel (name: string): Model {
  if (!modelsCache[name]) {
    modelsCache[name] = new Model(name)
  }
  return modelsCache[name]
}

export function useUserId (event: H3Event): string|ObjectId {
  if (!event.context.user?.id) {
    throw createError({ statusCode: 400, statusMessage: 'No user.id in event.context' })
  }
  return event.context.user.id
}
