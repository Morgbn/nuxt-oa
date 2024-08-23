/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from 'node:crypto'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import type { KeywordDefinition, ValidateFunction } from 'ajv'
import type { Collection, Document, Filter, ObjectId, OptionalUnlessRequiredId, WithId } from 'mongodb'
import { Hookable, type HookCallback, type HookKeys } from 'hookable'
import { createError, type H3Event } from 'h3'
import type { OaModels } from 'nuxt-oa'
import type { Schema } from '../../types'
import { defaultDbName, useCol, useDb, useObjectId } from './db'
import { pluralize } from './pluralize'
import { decrypt, encrypt } from './cipher'
import { useOaConfig } from './config'
import { useOaServerSchema, type OaModelName } from '~/.nuxt/oa/nitro'

const { cipherAlgo, cipherKey, cipherIvSize } = useOaConfig()
const { schemasByName, defsSchemas } = useOaServerSchema()

const ajv = new Ajv({ removeAdditional: true, schemas: defsSchemas })
addFormats(ajv)

type Timestamps = { createdAt?: boolean, updatedAt?: boolean }
type Userstamps = { createdBy?: boolean, updatedBy?: boolean, deletedBy?: boolean }

type OaDbItem<T extends OaModelName> = OaModels[T] & { _id?: ObjectId, createdAt?: string | Date, updatedAt?: string | Date, createdBy?: string | ObjectId, updatedBy?: string | ObjectId, updates?: unknown[], _iv?: string }
type OaSchema<T extends OaModelName> = (typeof schemasByName)[T] & { encryptedProperties?: string[], trackedProperties?: (keyof OaDbItem<T>)[], timestamps: Timestamps | boolean, userstamps: Userstamps | boolean }
type OaTrackedProps<T extends OaModelName> = keyof OaDbItem<T> & string

type HookResult = Promise<void> | void
type HookArgData = { data: Schema }
type HookArgDoc = { document?: WithId<Document> | null }
type HookArgEv = { event?: H3Event }
type HookArgIds = { id: string | ObjectId | undefined, _id: ObjectId }
export interface ModelNuxtOaHooks<T extends OaModelName> {
  'collection:ready': (d: { collection: Collection<OaDbItem<T>>, dbName: string, defaultDbName: string }) => HookResult
  'collection:before': (d: { setDb: (dbName: string) => void, defaultDbName: string }) => HookResult
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

export function cleanSchema(schema: Schema): Schema {
  schema.type = 'object' //  type must be object
  delete schema.encryptedProperties
  delete schema.trackedProperties
  delete schema.timestamps
  delete schema.userstamps
  return schema
}

export default class Model<T extends OaModelName> extends Hookable<ModelNuxtOaHooks<T>> {
  name: T
  encryptedProps: string[]
  cipherKey: Buffer | undefined
  trackedProps: OaTrackedProps<T>[]
  timestamps: Timestamps
  userstamps: Userstamps
  schema: Schema
  validator: ValidateFunction
  getAllCleaner: (el: Partial<WithId<OaDbItem<T>>>) => Partial<OaDbItem<T>>
  private collectionName: string
  private dbName: string
  private allDbNames: Set<string>
  private onBeforeGetCollection: ModelNuxtOaHooks<T>['collection:before']
  private skipHookBeforeGetCol = false

  constructor(name: T) {
    super()
    if (!schemasByName[name]) {
      throw new Error(`Can not found schema "${name}"`)
    }
    this.name = name
    this.collectionName = pluralize(name)
    this.dbName = defaultDbName
    this.allDbNames = new Set([defaultDbName])
    this.onBeforeGetCollection = () => {}
    this.callHook('collection:ready', { collection: this.collection, dbName: defaultDbName, defaultDbName })

    const schema = schemasByName[name] as OaSchema<T>
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
    const props = new Set<OaTrackedProps<T>>() // props to put in updates
    if (Array.isArray(schema.trackedProperties)) {
      (schema.trackedProperties as OaTrackedProps<T>[]).forEach(props.add, props)
      props.add('updatedAt')
    } else if (schema.trackedProperties === true) { // track all
      for (const key in schema.properties) {
        // except readOnly properties & id & createdAt/By
        if (['id', 'createdAt', 'createdBy'].includes(key)) continue
        const k = key as keyof typeof schema.properties
        if ('readOnly' in schema.properties[k] && schema.properties[k].readOnly) continue
        props.add(k)
      }
      props.add('updatedAt')
    }
    this.trackedProps = [...props]
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

  get collection() {
    if (!this.skipHookBeforeGetCol) // check if dbName was not already set in this.db('…')
      // call onBeforeGetCollection and not this.callHook('collection:before',…) to have instantly set dbName
      this.onBeforeGetCollection({ setDb: (name: string) => this.db(name), defaultDbName })
    this.skipHookBeforeGetCol = false
    return useCol<OaDbItem<T>>(this.collectionName, useDb(this.dbName))
  }

  /** Change database on the fly */
  db(dbName: string) {
    this.dbName = dbName
    this.skipHookBeforeGetCol = true
    if (!this.allDbNames.has(dbName)) {
      this.allDbNames.add(dbName) // call it before to prevent infinite loop
      this.callHook('collection:ready', { collection: this.collection, dbName, defaultDbName })
      this.skipHookBeforeGetCol = true // removed when call "this.collection"
    } else this.allDbNames.add(dbName)
    return this
  }

  override hook<NameT extends HookKeys<ModelNuxtOaHooks<T>>>(name: NameT, function_: ModelNuxtOaHooks<T>[NameT] extends HookCallback ? ModelNuxtOaHooks<T>[NameT] : never, options?: { allowDeprecated?: boolean }): () => void {
    if (name === 'collection:before') {
      this.onBeforeGetCollection = function_
    }
    return super.hook(name, function_, options)
  }

  /**
   * Validate data against the model schema
   * @param d data
   */
  validate(d: Schema) {
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
  private rmPropsWithAttr(d: Schema, attr: string) {
    const stack: { el: Schema, schema: Schema, key?: string | number, parent?: Schema }[] = [{ el: d, schema: this.schema }]
    while (stack.length) {
      const { el, schema, key, parent } = stack.pop() || {}
      if (!el || !schema) continue
      if (schema[attr]) {
        if (parent && key) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete parent[key]
        } else { // root
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
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
  encrypt(d: Schema) {
    if (!this.cipherKey) return
    let _iv = d._iv
    if (!_iv) {
      d._iv = _iv = randomBytes(cipherIvSize).toString('base64')
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
  cleanJSON(d: any) {
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
  async getAll(event?: H3Event) {
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
  private async callHookDocument(action: 'update' | 'archive' | 'delete', _id: ObjectId, event?: H3Event): Promise<WithId<OaDbItem<T>> | null> {
    let document: WithId<OaDbItem<T>> | null = null
    await this.callHookWith(async (hooks: HookCallback[]) => {
      if (!hooks.length) return
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
  async create(d: OptionalUnlessRequiredId<OaDbItem<T>>, userId?: string | ObjectId, readOnlyData?: Partial<OaDbItem<T> & Schema> | null, event?: H3Event) {
    await this.callHook('create:before', { data: d, event })

    this.validate(d)
    const data = readOnlyData ? { ...d, ...readOnlyData } : d
    const at = new Date()
    const by = userId ? useObjectId(userId) : null
    if (this.timestamps.createdAt) data.createdAt = at
    if (this.timestamps.updatedAt) data.updatedAt = at
    if (this.userstamps.createdBy && by) data.createdBy = by
    if (this.userstamps.updatedBy && by) data.updatedBy = by

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
  async update(id: string | ObjectId | undefined, d: Partial<OaDbItem<T> & Schema>, userId?: string | ObjectId, readOnlyData?: Partial<OaDbItem<T> & Schema> | null, event?: H3Event) {
    const _id = useObjectId(id)
    await this.callHook('update:before', { id, _id, data: d, event })

    const document = await this.callHookDocument('update', _id, event)

    this.validate(d)
    const data = readOnlyData ? { ...d, ...readOnlyData } : d
    if (this.timestamps.updatedAt) data.updatedAt = new Date()
    if (this.userstamps.updatedBy && userId) data.updatedBy = useObjectId(userId)

    const instance = (this.trackedProps.length || this.cipherKey)
      ? document ?? await this.collection.findOne({ _id } as any)
      : null
    if (this.trackedProps.length && instance) {
      const update: Record<string, unknown> = {}
      for (const key of this.trackedProps) {
        // @ts-expect-error OaTrackedProps<T> # WithId<OaDbItem<T>>
        if (instance[key] !== undefined) update[key] = instance[key]
      }
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
  async archive(id: string | ObjectId | undefined, archive = true, userId?: string | ObjectId, event?: H3Event) {
    const _id = useObjectId(id)
    await this.callHook('archive:before', { id, _id, event })
    await this.callHookDocument('archive', _id, event)

    const data: Schema = { deletedAt: archive ? new Date() : undefined }
    if (this.userstamps.deletedBy) data.deletedBy = archive ? useObjectId(userId) : undefined
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
  async delete(id: string | ObjectId | undefined, event?: H3Event) {
    const _id = useObjectId(id)
    await this.callHook('delete:before', { id, _id, event })
    await this.callHookDocument('delete', _id, event)

    const { deletedCount } = await this.collection.deleteOne({ _id } as any)

    await this.callHook('delete:done', { data: { id }, deletedCount, event })
    return { deletedCount }
  }

  private async cursorFindEncrypted(filter: Filter<OaDbItem<T>>, multiple: boolean) {
    const r: WithId<OaDbItem<T>>[] = []
    if (this.cipherKey) {
      const cursor = this.collection.find()
      const keys = Object.keys(filter) as (keyof OaDbItem<T>)[]
      for await (const doc of cursor) {
        const iv = doc._iv
        if (!iv) continue // not encrypted
        let same = true
        for (let i = 0; i < keys.length && same; i++) {
          const key = keys[i] as keyof typeof doc
          const decrypted = decrypt(doc[key] as any, iv, this.cipherKey, cipherAlgo)
          same = JSON.stringify(decrypted) === JSON.stringify(filter[key])
        }
        if (same) {
          r.push(doc)
          if (!multiple) return r
        }
      }
    }
    return r
  }

  /** Selects encrypted documents and returns the selected documents */
  async findEncrypted(filter: Filter<OaDbItem<T>>) {
    return await this.cursorFindEncrypted(filter, true)
  }

  /** Selects encrypted document and returns the selected document */
  async findOneEncrypted(filter: Filter<OaDbItem<T>>): Promise<WithId<OaDbItem<T>> | null> {
    return (await this.cursorFindEncrypted(filter, false))[0] ?? null
  }
}

export type ModelInstance = typeof Model

const modelsCache: Record<string, any> = {}
export function useOaModel<T extends OaModelName>(name: T): Model<T> {
  if (!modelsCache[name]) {
    modelsCache[name] = new Model(name)
  }
  return modelsCache[name]
}

/** Add user-defined keywords to ajv instance used in OaModel */
const addKeywords = (keywords: KeywordDefinition[]) => {
  for (const keyword of keywords) {
    ajv.addKeyword(keyword)
  }
}

export function useOaModelAjv() {
  return {
    instance: ajv,
    addKeywords
  }
}
