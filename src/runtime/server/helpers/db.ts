import { MongoClient, ObjectId } from 'mongodb'
import { createError } from 'h3'
import { consola } from 'consola'
import type { Db, Collection } from 'mongodb'

import { useRuntimeConfig } from '#imports'

const { dbUrl, dbOptions } = useRuntimeConfig().oa

const client = new MongoClient(dbUrl ?? '', dbOptions)
client.connect()
  .then(() => {
    consola.success('Connected Successfully to MongoDB')
  })
  .catch((err: any) => {
    consola.error(`DB Connection Error: ${err.message}`)
    process.exit(1)
  })
const dbName = new URL(dbUrl ?? '').pathname.split('/').pop() ?? 'test'
const db = client.db(dbName)

export function useDb (name?: string): Db {
  return client.db(name ?? dbName)
}

export function useCol (name: string, aDb?: Db): Collection {
  return (aDb ?? db).collection(name)
}

export function useObjectId (id: number | string | ObjectId | Buffer | undefined): ObjectId {
  if (!id || !ObjectId.isValid(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad id' })
  }
  return new ObjectId(id)
}
