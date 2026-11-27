import type { OaSchema, OaTimestamps, OaUserstamps, Schema } from './types'

type StampsSchema = Pick<OaSchema, 'properties' | 'trackedProperties' | 'timestamps' | 'userstamps'>
type Stamps = { timestamps: OaTimestamps, userstamps: OaUserstamps, trackedProps: string[] }
const untrackable = ['id', 'createdAt', 'createdBy']

export const updatesDescription = 'Previous values of tracked properties, one entry per update'

/**
 * Resolve `timestamps` / `userstamps` (`true` = all) into fresh objects & props recorded in `updates`:
 * `trackedProperties` (`true` = all except readOnly / id / createdAt / createdBy) + `updatedAt` (forced on) & `updatedBy` (if userstamped); none if not tracking
 */
export const resolveStamps = (schema: StampsSchema): Stamps => {
  const timestamps: OaTimestamps = schema.timestamps === true ? { createdAt: true, updatedAt: true, deletedAt: true } : { ...schema.timestamps }
  const userstamps: OaUserstamps = schema.userstamps === true ? { createdBy: true, updatedBy: true, deletedBy: true } : { ...schema.userstamps }
  const { trackedProperties: tracked, properties = {} } = schema
  const props = new Set(!tracked
    ? []
    : Array.isArray(tracked)
      ? tracked
      : Object.keys(properties).filter(k => !untrackable.includes(k) && !(properties[k] as { readOnly?: boolean })?.readOnly))
  if (tracked) {
    timestamps.updatedAt = true
    props.add('updatedAt')
    if (userstamps.updatedBy) props.add('updatedBy')
  }
  return { timestamps, userstamps, trackedProps: [...props] }
}

/** Add props set by nuxt-oa (required `id`, enabled timestamps / userstamps) to a model schema; returns resolved stamps */
export function addStampProps(schema: Schema, readOnly = false): Stamps {
  const ro = readOnly ? { readOnly } : {}
  const tObjectId = { type: 'string', format: 'objectid', ...ro }
  const tDate = { type: 'string', format: 'date-time', ...ro }

  const stamps = resolveStamps(schema)
  const props: Record<string, Schema> = {}
  for (const [k, on] of Object.entries(stamps.timestamps)) if (on) props[k] = tDate
  for (const [k, on] of Object.entries(stamps.userstamps)) if (on) props[k] = tObjectId

  schema.properties = { id: tObjectId, ...schema.properties, ...props }
  schema.required = [...(schema.required ?? []), 'id']
  return stamps
}
