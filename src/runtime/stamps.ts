import type { Schema } from './types'

export const updatesDescription = 'Keeps track of some updated properties'

const stampKeys = (stamps: unknown, all: string[]) => stamps === true
  ? all
  : Object.entries(stamps || {}).reduce<string[]>((keys, [k, on]) => {
      if (on) keys.push(k)
      return keys
    }, [])

/** Add props set by nuxt-oa (required `id`, timestamps, userstamps, `updatedAt` if tracking) to a model schema */
export function addStampProps(schema: Schema, readOnly = false) {
  const ro = readOnly ? { readOnly } : {}
  const tObjectId = { type: 'string', format: 'objectid', ...ro }
  const tDate = { type: 'string', format: 'date-time', ...ro }

  const stamps: Record<string, Schema> = {}
  for (const k of stampKeys(schema.timestamps, ['createdAt', 'updatedAt', 'deletedAt'])) stamps[k] = tDate
  for (const k of stampKeys(schema.userstamps, ['createdBy', 'updatedBy', 'deletedBy'])) stamps[k] = tObjectId
  if (schema.trackedProperties) stamps.updatedAt = tDate

  schema.properties = { id: tObjectId, ...schema.properties, ...stamps }
  schema.required = [...(schema.required ?? []), 'id']
}
