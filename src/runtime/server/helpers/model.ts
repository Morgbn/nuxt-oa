import { randomBytes } from 'node:crypto'
import { useLogger } from '@nuxt/kit'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import type { ValidateFunction } from 'ajv'
import type { Collection, Document, ObjectId, OptionalUnlessRequiredId, WithId } from 'mongodb'
import { HookCallback, Hookable } from 'hookable'
import { createError } from 'h3'
import type { H3Event } from 'h3'
import type { Schema, OaModels, DefsSchema } from '../../types'
import { useCol, useObjectId } from './db'
import { pluralize } from './pluralize'
import { decrypt, encrypt } from './cipher'

import { useRuntimeConfig } from '#imports'

const logger = useLogger('nuxt-oa')
const { cipherAlgo, cipherKey, stringifiedSchemasByName, stringifiedDefsSchemas } = useRuntimeConfig().oa
const schemasByName = JSON.parse(stringifiedSchemasByName) as Record<keyof OaModels, Schema>
const defsSchemas = JSON.parse(stringifiedDefsSchemas) as DefsSchema[]

const ajv = new Ajv({ removeAdditional: true, schemas: defsSchemas })
addFormats(ajv)

type HookResult = Promise<void> | void
type HookArgData = { data: Schema }
type HookArgDoc = { document?: WithId<Document>|null }
type HookArgEv = { event?: H3Event }
type HookArgIds = { id: string|ObjectId|undefined, _id: ObjectId }
export interface ModelNuxtOaHooks<T extends keyof OaModels> {
  'collection:ready': ({ collection }: { collection: Collection<OaModels[T]> }) => HookResult
  'model:cleanJSON': (d: HookArgData) => HookResult
  'getAll:before': (d: HookArgEv) => HookResult
  'create:before': (d: HookArgData & HookArgEv) => HookResult
  'create:after': (d: HookArgData & HookArgEv) => HookResult
  'create:done': (d: HookArgData & HookArgEv) => HookResult
  'update:before': (d: HookArgData & HookArgEv & HookArgIds) => HookResult
  'update:document': (d: HookArgDoc & HookArgEv) => HookResult
  'update:after': (d: HookArgData & HookArgEv & HookArgIds) => HookResult
  'update:done': (d: HookArgData & HookArgEv) => HookResult
  'archive:before': (d: HookArgEv & HookArgIds) => HookResult
  'archive:document': (d: HookArgDoc & HookArgEv) => HookResult
  'archive:after': (d: HookArgData & HookArgEv & HookArgIds) => HookResult
  'archive:done': (d: HookArgData & HookArgEv) => HookResult
  'delete:before': (d: HookArgEv & HookArgIds) => HookResult
  'delete:document': (d: HookArgDoc & HookArgEv) => HookResult
  'delete:done': (d: HookArgData & HookArgEv & { deletedCount: number }) => HookResult
}

export function cleanSchema (schema: Schema): Schema {
  schema.type = 'object' //  type must be object
  delete schema.encryptedProperties
  delete schema.trackedProperties
  delete schema.timestamps
  delete schema.userstamps
  return schema
}

export default class Model<T extends keyof OaModels & string> extends Hookable<ModelNuxtOaHooks<T>> {
  name: T
  collection: Collection<OaModels[T]>
  encryptedProps: string[]
  cipherKey: Buffer|undefined
  trackedProps: (keyof OaModels[T])[]
  timestamps: { createdAt?: boolean, updatedAt?: boolean }
  userstamps: { createdBy?: boolean, updatedBy?: boolean, deletedBy?: boolean }
  schema: Schema
  validator: ValidateFunction
  getAllCleaner: (el: Partial<OaModels[T]>) => Partial<OaModels[T]>

  constructor (name: T) {
    super()
    if (!schemasByName[name]) {
      throw new Error(`Can not found schema "${name}"`)
    }
    this.name = name
    this.collection = useCol<OaModels[T]>(pluralize(name))
    this.callHook('collection:ready', { collection: this.collection })

    const schema: Schema = schemasByName[name]
    this.encryptedProps = []
    if (Array.isArray(schema.encryptedProperties)) { // props to encrypt
      this.encryptedProps = schema.encryptedProperties
      if (!cipherKey) {
        throw new Error(`[@nuxtjs/oa] cipherKey is required to encrypt data (you have "encryptedProperties" in "${this.name}" schema but no cipherKey defined in the module options)`)
      }
      this.cipherKey = Buffer.from(cipherKey, 'base64')
      if (this.cipherKey.length !== 32) {
        throw new Error('[@nuxtjs/oa] cipherKey must be a 32-bit key')
      }
    }
    this.trackedProps = [] // props to put in updates
    if (Array.isArray(schema.trackedProperties)) {
      const props = new Set(schema.trackedProperties)
      props.add('updatedAt')
      this.trackedProps = [...props]
    } else if (schema.trackedProperties === true) { // track all
      for (const key in schema.properties) {
        if (!schema.properties[key].readOnly) { // expect readOnly properties
          this.trackedProps.push(key)
        }
      }
      this.trackedProps.push('updatedAt')
    }
    this.timestamps = typeof schema.timestamps === 'object'
      ? schema.timestamps
      : (!schema.timestamps ? {} : { createdAt: true, updatedAt: true })
    if (this.trackedProps.length) { // if tracking props
      this.timestamps.updatedAt = true // need updatedAt
    }
    this.userstamps = typeof schema.userstamps === 'object'
      ? schema.userstamps
      : (!schema.userstamps ? {} : { createdBy: true, updatedBy: true, deletedBy: true })

    this.schema = { additionalProperties: false, ...schema } // set additionalProperties to false by default
    cleanSchema(this.schema)

    this.validator = ajv.compile(this.schema)

    this.getAllCleaner = (el: object) => this.cleanJSON(el)
  }

  /**
   * Validate data against the model schema
   * @param d data
   */
  validate (d: Schema) {
    this.rmPropsWithAttr(d, 'readOnly')
    const valid = this.validator(d)
    if (!valid) {
      const { errors } = this.validator
      throw createError({ statusCode: 400, statusMessage: 'Bad data', data: { errors } })
    }
  }

  /**
   * Removes properties if a given attribute is present in the schema
   * @param d data
   * @param attr the attribute that triggers the deletion
   */
  private rmPropsWithAttr (d: Schema, attr: string) {
    const stack: { el: Schema, schema: Schema, key?: string|number, parent?: Schema}[] = [{ el: d, schema: this.schema }]
    while (stack.length) {
      const { el, schema, key, parent } = stack.pop() || {}
      if (!el || !schema) { continue }
      if (schema[attr]) {
        if (parent && key) {
          delete parent[key]
        } else { // root
          Object.keys(d).forEach(key => delete d[key]) // rm all data
          return
        }
        continue
      }
      if (schema.type === 'object') {
        for (const key in schema.properties) {
          stack.push({ el: el[key], schema: schema.properties[key], key, parent: el })
        }
      } else if (schema.type === 'array') {
        for (let i = 0; i < el.length; i++) {
          stack.push({ el: el[i], schema: schema.items, key: i, parent: el })
        }
      }
    }
  }

  /**
   * Encrypt object props
   * @param d json
   */
  encrypt (d: Schema) {
    if (!this.cipherKey) { return }
    let _iv = d._iv
    if (!_iv) {
      d._iv = _iv = randomBytes(16).toString('base64')
    }
    for (const key of this.encryptedProps) {
      if (d[key] !== undefined && d[key] !== null) {
        d[key] = encrypt(d[key], _iv, this.cipherKey, cipherAlgo)
      }
    }
  }

  /**
   * Clean an object
   *  - remove properties to omit
   *  - replace _id by id
   *  - decrypt props if needed
   * @param d representation of a model instance
   */
  cleanJSON (d: any) {
    const _iv = d._iv
    const data = { ...d, id: d._id }
    delete data._id
    delete data._iv
    this.rmPropsWithAttr(data, 'writeOnly') // remove properties to omit

    if (this.cipherKey) { // need to decrypt some properties
      for (const key of this.encryptedProps) {
        data[key] = decrypt(data[key], _iv, this.cipherKey, cipherAlgo)
      }
      if (this.trackedProps.length && Array.isArray(data.updates)) { // tracked props remain crypted
        for (const update of data.updates) {
          for (const key of this.encryptedProps) {
            update[key] = decrypt(update[key], _iv, this.cipherKey, cipherAlgo)
          }
        }
      }
    }

    this.callHook('model:cleanJSON', { data })
    return data
  }

  /**
   * Get all instances of the model
   * @param event incoming request
   */
  async getAll (event?: H3Event) {
    await this.callHook('getAll:before', { event })
    return (await this.collection.find({}).toArray()).map(this.getAllCleaner)
  }

  /**
   * Retrieve mongodb document if one or more hooks '[action]:document' are set
   * @param action
   * @param _id document id
   * @param event incoming request
   * @returns document
   */
  private async callHookDocument (action: 'update'|'archive'|'delete', _id: ObjectId, event?: H3Event): Promise<WithId<OaModels[T]>|null> {
    let document: WithId<OaModels[T]>|null = null
    await this.callHookWith(async (hooks: HookCallback[]) => {
      if (!hooks.length) { return }
      document = await this.collection.findOne({ _id } as any)
      const proms = hooks.map(caller => caller({ document, event }))
      return Promise.all(proms)
    }, `${action}:document`, {})
    return document
  }

  /**
   * Create a new model instance
   * @param d body (data from user)
   * @param userId user id
   * @param readOnlyData data from application logic
   * @param event incoming request
   */
  async create (d: OptionalUnlessRequiredId<OaModels[T]>, userId?: string|ObjectId, readOnlyData?: Partial<OaModels[T] & Schema>|null, event?: H3Event) {
    await this.callHook('create:before', { data: d, event })

    this.validate(d)
    const data = readOnlyData ? { ...d, ...readOnlyData } : d
    const at = new Date()
    const by = userId ? useObjectId(userId) : null
    if (this.timestamps.createdAt) { data.createdAt = at }
    if (this.timestamps.updatedAt) { data.updatedAt = at }
    if (this.userstamps.createdBy && by) { data.createdBy = by }
    if (this.userstamps.updatedBy && by) { data.updatedBy = by }

    await this.callHook('create:after', { data, event })

    this.encrypt(data)
    const { insertedId } = await this.collection.insertOne(data)

    const json = this.cleanJSON({ _id: insertedId, ...data })
    await this.callHook('create:done', { data: json, event })
    return json
  }

  /**
   * Update a model instance
   * @param id instance id
   * @param d body (data from user)
   * @param userId user id
   * @param readOnlyData data from application logic
   * @param event incoming request
   */
  async update (id: string|ObjectId|undefined, d: Partial<OaModels[T] & Schema>, userId?: string|ObjectId, readOnlyData?: Partial<OaModels[T] & Schema>|null, event?: H3Event) {
    const _id = useObjectId(id)
    await this.callHook('update:before', { id, _id, data: d, event })

    const document = await this.callHookDocument('update', _id, event)

    this.validate(d)
    const data = readOnlyData ? { ...d, ...readOnlyData } : d
    if (this.timestamps.updatedAt) { data.updatedAt = new Date() }
    if (this.userstamps.updatedBy && userId) { data.updatedBy = useObjectId(userId) }

    const instance = (this.trackedProps.length || this.cipherKey)
      ? document ?? await this.collection.findOne({ _id } as any)
      : null
    if (this.trackedProps.length && instance) {
      const update = this.trackedProps.reduce((o, key) => ({ ...o, [key]: instance[key] }), {})
      data.updates = [...(instance.updates || []), update]
    }

    await this.callHook('update:after', { id, _id, data, event })

    if (this.cipherKey && instance) {
      data._iv = instance._iv
      this.encrypt(data)
    }
    const { value } = await this.collection
      .findOneAndUpdate({ _id } as any, { $set: data }, { returnDocument: 'after' })
    if (!value) {
      throw createError({ statusCode: 404, statusMessage: 'Document not found' })
    }

    const json = this.cleanJSON(value)
    await this.callHook('update:done', { data: json, event })
    return json
  }

  /**
   * Archive a model instance
   * @param id instance  id
   * @param archive whether to archive or unarchive
   * @param userId user id
   * @param event incoming request
   */
  async archive (id: string|ObjectId|undefined, archive = true, userId?: string|ObjectId, event?: H3Event) {
    const _id = useObjectId(id)
    await this.callHook('archive:before', { id, _id, event })
    await this.callHookDocument('archive', _id, event)

    const data: Schema = { deletedAt: archive ? new Date() : undefined }
    if (this.userstamps.deletedBy) { data.deletedBy = archive ? useObjectId(userId) : undefined }
    await this.callHook('archive:after', { id, _id, data, event })

    const { value } = await this.collection
      .findOneAndUpdate({ _id } as any, { $set: data } as any, { returnDocument: 'after' })
    if (!value) {
      throw createError({ statusCode: 404, statusMessage: 'Document not found' })
    }

    const json = this.cleanJSON(value)
    await this.callHook('archive:done', { data: json, event })
    return json
  }

  /**
   * Delete a model instance
   * @param id instance id
   * @param event incoming request
   */
  async delete (id: string|ObjectId|undefined, event?: H3Event) {
    const _id = useObjectId(id)
    await this.callHook('delete:before', { id, _id, event })
    await this.callHookDocument('delete', _id, event)

    const { deletedCount } = await this.collection.deleteOne({ _id } as any)

    await this.callHook('delete:done', { data: { id }, deletedCount, event })
    return { deletedCount }
  }
}

export type ModelInstance = typeof Model

const modelsCache: Record<string, any> = {}
export function useOaModel<T extends keyof OaModels & string> (name: T): Model<T> {
  if (!modelsCache[name]) {
    modelsCache[name] = new Model(name)
  }
  return modelsCache[name]
}

/**
 * @deprecated use 'useOaModel' instead
 */
export function useModel<T extends keyof OaModels & string> (name: T): Model<T> {
  logger.warn('"useModel" is deprecated. Use "useOaModel" instead.')
  return useOaModel(name)
}
