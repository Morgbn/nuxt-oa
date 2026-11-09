/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from 'node:crypto'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import type { KeywordDefinition, ValidateFunction } from 'ajv'
import { MongoBulkWriteError, MongoServerError } from 'mongodb'
import type { Collection, Document, Filter, ObjectId, OptionalUnlessRequiredId, WithId, WriteError } from 'mongodb'
import { Hookable, type HookCallback, type HookKeys } from 'hookable'
import { createError, type H3Event } from 'h3'
import type { OaModels, OaModelName } from 'nuxt-oa'
import type { Schema } from '../../types'
import { defaultDbName, useCol, useDb, useObjectId } from './db'
import { pluralize } from './pluralize'
import { decrypt, encrypt } from './cipher'
import { useOaConfig } from './config'
import * as _ from './_'
import { useOaServerSchema } from '#oa-nitro'

const { cipherAlgo, cipherKey, cipherIvSize, dbClientOnRenderer, maxBulkSize: defaultMaxBulkSize } = useOaConfig()
const { schemasByName, defsSchemas } = useOaServerSchema()
const noDbClient = import.meta.prerender && !dbClientOnRenderer

const ajv = new Ajv({ removeAdditional: true, schemas: defsSchemas })
addFormats(ajv)

type Timestamps = { createdAt?: boolean, updatedAt?: boolean }
type Userstamps = { createdBy?: boolean, updatedBy?: boolean, deletedBy?: boolean }

type OaDbItem<T extends OaModelName> = Omit<OaModels[T], 'id'> & { _id?: ObjectId, createdAt?: string | Date, updatedAt?: string | Date, createdBy?: string | ObjectId, updatedBy?: string | ObjectId, updates?: Record<string, unknown>[], _iv?: string }
type OaTrackedProps<T extends OaModelName> = keyof OaDbItem<T> & string
type OaSchema<T extends OaModelName> = { properties: Schema, encryptedProperties?: string[], trackedProperties?: OaTrackedProps<T>[], timestamps: Timestamps | boolean, userstamps: Userstamps | boolean, maxBulkSize?: number }

type HookResult = Promise<void> | void
type HookArgData = { data: Schema }
type HookArgDataArray = { data: Schema[] }
type HookArgDoc = { document?: WithId<Document> | null }
type HookArgDocs = { documents: WithId<Document>[] }
type HookArgEv = { event?: H3Event }
type HookArgIds = { id: string | ObjectId | undefined, _id: ObjectId }
// ids is the raw input as given by the caller; _ids only contains the ones that parsed successfully —
// they don't correspond by index/length when some ids are malformed
type HookArgIdsArray = { ids: (string | ObjectId | undefined)[], _ids: ObjectId[] }
type HookArgErrors = { errors: { data?: Schema, error: unknown }[] }
export interface ModelNuxtOaHooks<T extends OaModelName> {
  'collection:ready': (d: { collection: Collection<OaDbItem<T>>, dbName: string, defaultDbName: string }) => HookResult
  'collection:before': (d: { setDb: (dbName: string) => void, defaultDbName: string }) => HookResult
  'model:cleanJSON': (d: HookArgData) => HookResult
  'getAll:before': (d: HookArgEv) => HookResult
  'create:before': (d: HookArgData & HookArgEv) => HookResult
  'create:after': (d: HookArgData & HookArgEv) => HookResult
  'create:done': (d: HookArgData & HookArgEv) => HookResult
  'bulkCreate:before': (d: HookArgDataArray & HookArgEv) => HookResult
  'bulkCreate:after': (d: HookArgDataArray & HookArgEv & HookArgErrors) => HookResult
  'bulkCreate:done': (d: HookArgDataArray & HookArgEv & HookArgErrors) => HookResult
  'update:before': (d: HookArgData & HookArgEv & HookArgIds) => HookResult
  'update:document': (d: HookArgDoc & HookArgEv) => HookResult
  'update:after': (d: HookArgData & HookArgEv & HookArgIds) => HookResult
  'update:done': (d: HookArgData & HookArgEv) => HookResult
  'bulkUpdate:before': (d: HookArgDataArray & HookArgEv & HookArgIdsArray) => HookResult
  'bulkUpdate:documents': (d: HookArgDocs & HookArgEv) => HookResult
  'bulkUpdate:after': (d: HookArgDataArray & HookArgEv & HookArgErrors) => HookResult
  'bulkUpdate:done': (d: HookArgDataArray & HookArgEv & HookArgErrors) => HookResult
  'archive:before': (d: HookArgEv & HookArgIds) => HookResult
  'archive:document': (d: HookArgDoc & HookArgEv) => HookResult
  'archive:after': (d: HookArgData & HookArgEv & HookArgIds) => HookResult
  'archive:done': (d: HookArgData & HookArgEv) => HookResult
  'bulkArchive:before': (d: HookArgEv & HookArgIdsArray) => HookResult
  'bulkArchive:documents': (d: HookArgDocs & HookArgEv) => HookResult
  'bulkArchive:after': (d: HookArgData & HookArgEv & { _ids: ObjectId[] } & HookArgErrors) => HookResult
  'bulkArchive:done': (d: HookArgDataArray & HookArgEv & HookArgErrors) => HookResult
  'delete:before': (d: HookArgEv & HookArgIds) => HookResult
  'delete:document': (d: HookArgDoc & HookArgEv) => HookResult
  'delete:done': (d: HookArgData & HookArgEv & { deletedCount: number }) => HookResult
  'bulkDelete:before': (d: HookArgEv & HookArgIdsArray) => HookResult
  'bulkDelete:documents': (d: HookArgDocs & HookArgEv) => HookResult
  'bulkDelete:done': (d: HookArgDataArray & HookArgEv & HookArgErrors) => HookResult
}

type SettledWithErrorsOptions<Item, R> = {
  items: Item[]
  run: (item: Item, index: number) => Promise<R> | R
  errors: HookArgErrors['errors']
  errorData?: (item: Item, causeData: Schema | undefined, index: number) => Schema | undefined
}

const bulkActionMap = { update: 'bulkUpdate', archive: 'bulkArchive', delete: 'bulkDelete' } as const

export function cleanSchema(schema: Schema): Schema {
  schema.type = 'object' //  type must be object
  delete schema.encryptedProperties
  delete schema.trackedProperties
  delete schema.timestamps
  delete schema.userstamps
  delete schema.maxBulkSize
  return schema
}

export default class Model<T extends OaModelName> extends Hookable<ModelNuxtOaHooks<T>> {
  name: T
  encryptedProps: string[]
  cipherKey: Buffer | undefined
  trackedProps: OaTrackedProps<T>[]
  timestamps: Timestamps
  userstamps: Userstamps
  maxBulkSize: number
  schema: Schema
  validator: ValidateFunction
  getAllCleaner: (el: Partial<OaDbItem<T>> | WithId<OaDbItem<T>>) => Omit<Partial<OaDbItem<T>> | WithId<OaDbItem<T>>, '_id' | '_iv'> & { id?: ObjectId }
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
      if (!noDbClient && !cipherKey) {
        throw new Error(`[@nuxtjs/oa] cipherKey is required to encrypt data (you have "encryptedProperties" in "${this.name}" schema but no cipherKey defined in the module options)`)
      }
      this.cipherKey = Buffer.from(cipherKey, 'base64')
      if (!noDbClient && this.cipherKey.length !== 32) {
        throw new Error('[@nuxtjs/oa] cipherKey must be a 32-bit key')
      }
    }

    this.userstamps = typeof schema.userstamps === 'object'
      ? schema.userstamps
      : (!schema.userstamps ? {} : { createdBy: true, updatedBy: true, deletedBy: true })
    this.timestamps = typeof schema.timestamps === 'object'
      ? schema.timestamps
      : (!schema.timestamps ? {} : { createdAt: true, updatedAt: true })
    this.maxBulkSize = schema.maxBulkSize ?? defaultMaxBulkSize

    const props = new Set<string>() // props to put in updates
    props.add('updatedAt') // always add updatedAt
    if (this.userstamps.updatedBy) props.add('updatedBy') // add updatedBy if configured
    if (Array.isArray(schema.trackedProperties)) {
      schema.trackedProperties.forEach(props.add, props)
    } else if (schema.trackedProperties === true) { // track all
      for (const key in schema.properties) {
        // except readOnly properties & id & createdAt/By
        if (['id', 'createdAt', 'createdBy'].includes(key)) continue
        if ('readOnly' in schema.properties[key] && schema.properties[key].readOnly) continue
        props.add(key)
      }
    }
    this.trackedProps = [...props] as OaTrackedProps<T>[]
    if (this.trackedProps.length) { // if tracking props
      this.timestamps.updatedAt = true // need updatedAt
    }

    this.schema = { additionalProperties: false, ...schema } // set additionalProperties to false by default
    cleanSchema(this.schema)

    this.validator = ajv.compile(this.schema)

    this.getAllCleaner = el => this.cleanJSON(el)
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
        if (parent && key !== undefined) {
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
        if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          for (const key in el) {
            if (schema.properties && key in schema.properties) continue
            stack.push({ el: el[key], schema: schema.additionalProperties, key, parent: el })
          }
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
    for (const path of this.encryptedProps) {
      const val = _.get(d, path)
      if (val !== undefined && val !== null)
        _.set(d, path, encrypt(val, _iv, this.cipherKey, cipherAlgo))
    }
  }

  /**
   * Clean an object
   *  - remove properties to omit
   *  - replace _id by id
   *  - decrypt props if needed
   * @param d representation of a model instance
   */
  cleanJSON<D extends Partial<OaDbItem<T>> | WithId<OaDbItem<T>> | OptionalUnlessRequiredId<OaDbItem<T>>>(d: D): Omit<D, '_id' | '_iv'> & { id?: ObjectId } {
    const _iv = d._iv
    const data = { ...d, id: d._id }
    delete data._id
    delete data._iv
    this.rmPropsWithAttr(data, 'writeOnly') // remove properties to omit

    if (this.cipherKey && _iv) { // need to decrypt some properties
      for (const path of this.encryptedProps) {
        _.set(data, path, decrypt(_.get(data, path), _iv, this.cipherKey, cipherAlgo))
      }
      const updates = data.updates ?? []
      if (this.trackedProps.length && updates?.length) { // tracked props remain crypted
        for (const update of updates) {
          for (const path of this.encryptedProps) {
            _.set(update, path, decrypt(_.get(update, path) as string, _iv, this.cipherKey, cipherAlgo))
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
   * Retrieve mongodb documents if one or more hooks '[action]:document' are set, isolating a
   * single document's hook rejection to that document (via `rejectedIds`) instead of aborting the batch.
   * The bulk '[bulkAction]:documents' hook only receives the documents that survived that per-document
   * hook, so it reflects what will actually continue through the batch, not the raw fetched set.
   * @param action
   * @param _ids documents id
   * @param errors errors accumulator
   * @param event incoming request
   * @returns fetched documents (unfiltered) and the ids whose single-document hook rejected
   */
  private async callHookDocuments(action: 'update' | 'archive' | 'delete', _ids: ObjectId[], errors: HookArgErrors['errors'], event?: H3Event): Promise<{ documents: WithId<OaDbItem<T>>[], rejectedIds: Set<string> } | null> {
    const docHooks = await new Promise<HookCallback[]>(resolve => this.callHookWith(resolve, `${action}:document`, {}))
    const docsHooks = await new Promise<HookCallback[]>(resolve => this.callHookWith(resolve, `${bulkActionMap[action]}:documents`, {}))

    if (!docHooks.length && !docsHooks.length) return null
    const documents = await this.collection.find({ _id: { $in: _ids } } as any).toArray()

    const survivors = await this.settleWithErrors({
      items: documents,
      run: async (document) => {
        await Promise.all(docHooks.map(caller => caller({ document, event })))
        return document
      },
      errors,
      errorData: document => ({ id: `${document._id}` })
    })

    // Only the documents that survived the per-document hook are actually going to be processed further down
    await Promise.all(docsHooks.map(caller => caller({ documents: survivors, event })))

    const survivorIds = new Set(survivors.map(doc => doc._id.toString()))
    const rejectedIds = new Set(documents.filter(doc => !survivorIds.has(doc._id.toString())).map(doc => doc._id.toString()))
    return { documents, rejectedIds }
  }

  /**
   * Guard against oversized bulk payloads before any hook or DB work runs
   * @param items array submitted to a bulk* method
   */
  private assertBulkSize(items: unknown[]) {
    if (items.length > this.maxBulkSize)
      throw createError({
        statusCode: 400,
        statusMessage: 'Too many items',
        data: { max: this.maxBulkSize, received: items.length }
      })
  }

  /**
   * Safely parse an id, returning null instead of throwing on a malformed id
   * @param id
   */
  private tryObjectId(id: string | ObjectId | undefined): ObjectId | null {
    try {
      return useObjectId(id)
    } catch {
      return null
    }
  }

  /**
   * Parse a raw id, isolating a malformed or duplicate id as an error
   * @param id raw id to parse
   * @param seenIds ids already parsed in this batch, for duplicate detection
   * @param errors errors accumulator
   * @param errorData error entry data, defaults to `{ id }`
   */
  private parseId(id: string | ObjectId | undefined, seenIds: Set<string>, errors: HookArgErrors['errors'], errorData?: Schema): ObjectId | null {
    const _id = this.tryObjectId(id)
    if (!_id) {
      errors.push({ data: errorData ?? { id: `${id}` }, error: 'Bad id' })
      return null
    }
    const key = _id.toString()
    if (seenIds.has(key)) {
      errors.push({ data: errorData ?? { id: `${id}` }, error: 'Duplicate id' })
      return null
    }
    seenIds.add(key)
    return _id
  }

  /**
   * Extract a readable message from a rejected settled result
   * Hooks are user-defined and may reject with anything (a string, a plain object, ...), not just an Error
   * @param reason
   */
  private errorMessage(reason: unknown): string {
    if (reason instanceof Error) return reason.message
    return typeof reason === 'string' ? reason : String(reason)
  }

  /**
   * Normalize a rejection (thrown validation error, hook error, malformed id, ...) into an error entry
   * @param reason
   */
  private toErrorEntry(reason: unknown): { data?: Schema, error: unknown } {
    if (reason && typeof reason === 'object' && 'cause' in reason) {
      const cause = (reason as { cause?: unknown }).cause
      if (cause && typeof cause === 'object') {
        const { data, statusMessage } = cause as { data?: Schema, statusMessage?: unknown }
        return { data, error: statusMessage ?? this.errorMessage(reason) }
      }
    }
    return { error: this.errorMessage(reason) }
  }

  /**
   * MongoDB reports `writeErrors` as a single WriteError or an array depending on driver version
   * @param writeErrors
   */
  private normalizeWriteErrors(writeErrors: WriteError | readonly WriteError[] | undefined): WriteError[] {
    if (!writeErrors) return []
    return Array.isArray(writeErrors) ? [...writeErrors] : [writeErrors as WriteError]
  }

  /**
   * MongoDB's raw `errmsg` can leak internal details
   * map known error codes to a safe, generic message
   */
  private writeErrorMessage(writeError: { code?: number | string } | undefined): string {
    if (!writeError) return 'Write error'
    return writeError.code === 11000 ? 'Duplicate key' : 'Write error'
  }

  /**
   * Run a per-item task via Promise.allSettled, pushing a normalized error entry for each rejection
   */
  private async settleWithErrors<Item, R>(opt: SettledWithErrorsOptions<Item, R>): Promise<R[]> {
    const settled = await Promise.allSettled(opt.items.map(opt.run))
    const fulfilled: R[] = []
    for (const [i, result] of settled.entries()) {
      if (result.status === 'fulfilled') {
        fulfilled.push(result.value)
      } else {
        const { data, error } = this.toErrorEntry(result.reason)
        const errorData = opt.errorData ? opt.errorData(opt.items[i]!, data, i) : data ?? opt.items[i]!
        opt.errors.push({ data: errorData, error })
      }
    }
    return fulfilled
  }

  /**
   * Create data helper
   * @param d body (data from user)
   * @param readOnlyData data from application logic
   * @param event incoming request
   * @param userId user id
   * @param at timestamp
   */
  private async createHelper(d: OptionalUnlessRequiredId<OaDbItem<T>>, readOnlyData?: Partial<OaDbItem<T> & Schema> | null, event?: H3Event, userId?: string | ObjectId, at = new Date()) {
    await this.callHook('create:before', { data: d, event })

    this.validate(d)
    const data = readOnlyData ? { ...d, ...readOnlyData } : d
    const by = userId ? useObjectId(userId) : null
    if (this.timestamps.createdAt) data.createdAt = at
    if (this.timestamps.updatedAt) data.updatedAt = at
    if (this.userstamps.createdBy && by) data.createdBy = by
    if (this.userstamps.updatedBy && by) data.updatedBy = by

    await this.callHook('create:after', { data, event })

    this.encrypt(data)
    return data
  }

  /**
   * Create a new model instance
   * @param d body (data from user)
   * @param userId user id
   * @param readOnlyData data from application logic
   * @param event incoming request
   */
  async create(d: OptionalUnlessRequiredId<OaDbItem<T>>, userId?: string | ObjectId, readOnlyData?: Partial<OaDbItem<T> & Schema> | null, event?: H3Event) {
    const data = await this.createHelper(d, readOnlyData, event, userId)
    const { insertedId } = await this.collection.insertOne(data)
    const json = this.cleanJSON({ _id: insertedId, ...data })
    await this.callHook('create:done', { data: json, event })
    return json
  }

  /**
   * Create multiple model instances
   * @param d array of bodies (data from user)
   * @param userId user id
   * @param readOnlyData data from application logic
   * @param event incoming request
   */
  async bulkCreate(d: OptionalUnlessRequiredId<OaDbItem<T>>[], userId?: string | ObjectId, readOnlyData?: Partial<OaDbItem<T> & Schema> | null, event?: H3Event) {
    this.assertBulkSize(d)
    await this.callHook('bulkCreate:before', { data: d, event })
    // Prepare data
    const at = new Date()
    const errors: HookArgErrors['errors'] = []
    // index is the item's position in `d`, kept alongside data so a failure (validation or write)
    // can be linked back to the submitted item even when several items are identical
    const prepared = await this.settleWithErrors({
      items: d,
      run: async (item, index) => ({ index, data: await this.createHelper(item, readOnlyData, event, userId, at) }),
      errors,
      errorData: (item, data, index) => ({ index, ...data })
    })
    const preparedItems = prepared.map(p => p.data)
    await this.callHook('bulkCreate:after', { data: preparedItems, errors, event })
    // Insert valid data
    const results: ReturnType<typeof this.cleanJSON>[] = []
    if (prepared.length) {
      let insertedIds: Record<number, ObjectId>
      let writeErrors: WriteError[] = []
      try {
        const bulkResult = await this.collection.insertMany(preparedItems, { ordered: false })
        insertedIds = bulkResult.insertedIds
      } catch (error) {
        if (!(error instanceof MongoBulkWriteError)) throw error
        insertedIds = error.insertedIds
        writeErrors = this.normalizeWriteErrors(error.writeErrors)
      }
      // i = position in insertMany's array (for writeErrorByIndex); index = original position in `d`
      const writeErrorByIndex = new Map(writeErrors.map(we => [we.index, we]))
      for (const [i, { index, data }] of prepared.entries()) {
        const insertedId = insertedIds[i]
        if (insertedId !== undefined) {
          results.push(this.cleanJSON({ _id: insertedId, ...data }))
        } else {
          errors.push({ data: { index }, error: this.writeErrorMessage(writeErrorByIndex.get(i)) })
        }
      }
      await this.settleWithErrors({
        items: results,
        run: json => this.callHook('create:done', { data: json, event }),
        errors
      })
    }

    await this.callHook('bulkCreate:done', { data: results, errors, event })

    if (d.length && !results.length) throw createError({ statusCode: 400, statusMessage: 'Bad data', data: { errors } })

    return { results, errors }
  }

  /**
   * Upsert a model instance
   *
   * Attempts to find an existing document matching the given filter.
   * - If a document is found, it is updated.
   * - If no document is found, a new one is created.
   *
   * @param filter MongoDB filter used to locate an existing document.
   * @param d User-provided data used to create or update the document.
   * @param userId user id
   * @param readOnlyData data from application logic
   * @param event incoming request
   *  @remarks
   * This method does not use MongoDB's native `upsert` option.
   * Instead, it performs a read-then-write flow in order to:
   * - apply custom validation and authorization logic
   * - reuse existing `create` and `update` hooks
   */
  async upsert(filter: Filter<OaDbItem<T>>, d: OptionalUnlessRequiredId<OaDbItem<T>>, userId?: string | ObjectId, readOnlyData?: Partial<OaDbItem<T> & Schema> | null, event?: H3Event) {
    const document = await this.collection.findOne<WithId<OaDbItem<T>>>(filter)
    if (document) return this.update(document._id, d, userId, readOnlyData, event, document)
    return this.create(d, userId, readOnlyData, event)
  }

  /**
   * Create update data object
   * @param id instance id, as originally passed by the caller
   * @param _id instance id
   * @param d body (data from user)
   * @param document document already found
   * @param userId user id
   * @param readOnlyData data from application logic
   * @param event incoming request
   * @param date update date
   * @returns update data object
   */
  private async getUpdateData(id: string | ObjectId | undefined, _id: ObjectId, d: Partial<OaDbItem<T> & Schema>, document: WithId<OaDbItem<T>> | null, userId?: string | ObjectId, readOnlyData?: Partial<OaDbItem<T> & Schema> | null, event?: H3Event, date?: Date) {
    const data = readOnlyData ? { ...d, ...readOnlyData } : { ...d }

    if (this.timestamps.updatedAt) data.updatedAt = date ?? new Date()
    if (this.userstamps.updatedBy && userId) data.updatedBy = useObjectId(userId)
    // bulkUpdate callers may echo the whole document back, incl. _id — MongoDB rejects $set on an immutable _id
    if (data._id) delete data._id

    const instance = (this.trackedProps.length || this.cipherKey)
      ? document ?? await this.collection.findOne({ _id } as any)
      : null
    if (this.trackedProps.length && instance) {
      const update: Record<string, unknown> = {}
      for (const key of this.trackedProps) {
        if (instance[key] !== undefined) update[key] = instance[key]
      }
      data.updates = [...(instance.updates || []), update]
    }

    await this.callHook('update:after', { id, _id, data, event })

    if (this.cipherKey && instance) {
      data._iv = instance._iv
      this.encrypt(data)
    }
    return data
  }

  /**
   * Update a model instance
   * @param id instance id
   * @param d body (data from user)
   * @param userId user id
   * @param readOnlyData data from application logic
   * @param event incoming request
   * @param existingDoc document already found
   */
  async update(id: string | ObjectId | undefined, d: Partial<OaDbItem<T> & Schema>, userId?: string | ObjectId, readOnlyData?: Partial<OaDbItem<T> & Schema> | null, event?: H3Event, existingDoc?: WithId<OaDbItem<T>>) {
    const _id = useObjectId(id)
    await this.callHook('update:before', { id, _id, data: d, event })

    if (existingDoc) await this.callHook('update:document', { document: existingDoc, event })
    const document = existingDoc ?? await this.callHookDocument('update', _id, event)

    this.validate(d)
    const data = await this.getUpdateData(id, _id, d, document, userId, readOnlyData, event)

    const value = await this.collection
      .findOneAndUpdate({ _id } as any, { $set: data }, { returnDocument: 'after' })
    if (!value) {
      throw createError({ statusCode: 404, statusMessage: 'Document not found' })
    }

    const json = this.cleanJSON(value)
    await this.callHook('update:done', { data: json, event })
    return json
  }

  /**
   * Update multiple model instances
   * @param u array of updates { id, data }
   * @param userId user id
   * @param readOnlyData data from application logic
   * @param event incoming request
   */
  async bulkUpdate(u: { id: string | ObjectId, d: Partial<OaDbItem<T> & Schema> }[], userId?: string | ObjectId, readOnlyData?: Partial<OaDbItem<T> & Schema> | null, event?: H3Event) {
    this.assertBulkSize(u)
    const errors: HookArgErrors['errors'] = []
    // Parse ids, isolating malformed ones as errors instead of aborting the whole batch
    const seenIds = new Set<string>()
    const parsed: { id: string, _id: ObjectId, d: Partial<OaDbItem<T> & Schema> }[] = []
    for (const entry of u) {
      if (!entry || typeof entry !== 'object') {
        errors.push({ data: { id: `${entry}` }, error: 'Bad data' })
        continue
      }
      const { id, d } = entry
      const _id = this.parseId(id, seenIds, errors, { id: `${id}`, ...d })
      if (_id) parsed.push({ id: id.toString(), _id, d })
    }

    await this.callHook('bulkUpdate:before', {
      ids: u.map(entry => (entry && typeof entry === 'object') ? entry.id : undefined),
      _ids: parsed.map(p => p._id),
      data: parsed.map(p => p.d),
      event
    })

    // Isolate before-hook rejections instead of silently discarding them
    const updates = await this.settleWithErrors({
      items: parsed,
      run: async (update) => {
        await this.callHook('update:before', { id: update.id, _id: update._id, data: update.d, event })
        return update
      },
      errors,
      errorData: (update, data) => ({ id: update.id, ...data })
    })

    // Fetch all documents in ONE call
    const _ids = updates.map(update => update._id)
    const docsResult = await this.callHookDocuments('update', _ids, errors, event)
    const documents = docsResult?.documents ?? await this.collection.find({ _id: { $in: _ids } } as any).toArray()
    const documentsMap = new Map(documents.map(doc => [doc._id.toString(), doc]))
    const rejectedIds = docsResult?.rejectedIds ?? new Set<string>()

    const at = new Date()
    const bulkOps = await this.settleWithErrors({
      items: updates.filter(update => !rejectedIds.has(update._id.toString())),
      run: async (update) => {
        this.validate(update.d)
        const document = documentsMap.get(update._id.toString())
        if (!document) throw new Error('Document not found')
        const data = await this.getUpdateData(update.id, update._id, update.d, document, userId, readOnlyData, event, at)
        return {
          data,
          updateOne: {
            filter: { _id: update._id } as any,
            update: { $set: data }
          }
        }
      },
      errors,
      errorData: (update, data) => ({ id: `${update._id}`, ...data })
    })
    const fulfilledIds = bulkOps.map(op => op.updateOne.filter._id)
    await this.callHook('bulkUpdate:after', { data: bulkOps.map(op => op.data), errors, event })

    const results: ReturnType<typeof this.cleanJSON>[] = []
    if (bulkOps.length) {
      let writeErrors: WriteError[] = []
      try {
        await this.collection.bulkWrite(bulkOps.map(({ updateOne }) => ({ updateOne })), { ordered: false })
      } catch (error) {
        if (!(error instanceof MongoBulkWriteError)) throw error
        writeErrors = this.normalizeWriteErrors(error.writeErrors)
      }
      for (const writeError of writeErrors) {
        errors.push({ data: { id: `${fulfilledIds[writeError.index]}` }, error: this.writeErrorMessage(writeError) })
      }
      const failedIndices = new Set(writeErrors.map(we => we.index))
      const succeededIds = fulfilledIds.filter((_id, i) => !failedIndices.has(i))
      // bulkWrite + find below are two round trips, not one atomic op — a concurrent write to the
      // same document landing between them can leak into `results`.
      const updatedDocuments = await this.collection.find({ _id: { $in: succeededIds } } as any).toArray()
      for (const doc of updatedDocuments) results.push(this.cleanJSON(doc))

      // A succeeded write can still fail to come back here
      const updatedIds = new Set(results.map(j => j.id?.toString()))
      for (const _id of succeededIds) {
        if (!updatedIds.has(_id.toString())) errors.push({ data: { id: `${_id}` }, error: 'Document not found' })
      }
    }

    await this.settleWithErrors({
      items: results,
      run: json => this.callHook('update:done', { data: json, event }),
      errors
    })
    await this.callHook('bulkUpdate:done', { data: results, errors, event })

    if (u.length && !results.length) throw createError({ statusCode: 400, statusMessage: 'Bad data', data: { errors } })

    return { results, errors }
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

    const value = await this.collection
      .findOneAndUpdate({ _id } as any, { $set: data } as any, { returnDocument: 'after' })
    if (!value) {
      throw createError({ statusCode: 404, statusMessage: 'Document not found' })
    }

    const json = this.cleanJSON(value)
    await this.callHook('archive:done', { data: json, event })
    return json
  }

  /**
   * Archive multiple model instances
   * @param ids array of instance ids
   * @param archive whether to archive or unarchive
   * @param userId user id
   * @param event incoming request
   */
  async bulkArchive(ids: (string | ObjectId | undefined)[], archive = true, userId?: string | ObjectId, event?: H3Event) {
    this.assertBulkSize(ids)
    const errors: HookArgErrors['errors'] = []
    // Parse ids, isolating malformed ones as errors instead of aborting the whole batch
    const seenIds = new Set<string>()
    const parsed: { id: string | ObjectId | undefined, _id: ObjectId }[] = []
    for (const id of ids) {
      const _id = this.parseId(id, seenIds, errors)
      if (_id) parsed.push({ id, _id })
    }

    await this.callHook('bulkArchive:before', { ids, _ids: parsed.map(p => p._id), event })

    // Isolate before-hook rejections instead of silently discarding them
    let entries = await this.settleWithErrors({
      items: parsed,
      run: async (p) => {
        await this.callHook('archive:before', { id: p.id, _id: p._id, event })
        return p
      },
      errors,
      errorData: (p, data) => ({ id: `${p.id}`, ...data })
    })

    const docsResult = await this.callHookDocuments('archive', entries.map(p => p._id), errors, event)
    const rejectedIds = docsResult?.rejectedIds ?? new Set<string>()
    entries = entries.filter(p => !rejectedIds.has(p._id.toString()))

    const data: Schema = { deletedAt: archive ? new Date() : undefined }
    if (this.userstamps.deletedBy) data.deletedBy = archive ? useObjectId(userId) : undefined

    // Isolate after-hook rejections instead of silently discarding them
    // `data` is cloned per call because all entries share one updateMany below — unlike
    // single-item archive(), a hook mutating `data` here has no effect on what gets written
    entries = await this.settleWithErrors({
      items: entries,
      run: async (p) => {
        await this.callHook('archive:after', { id: p.id, _id: p._id, data: { ...data }, event })
        return p
      },
      errors,
      errorData: (p, errData) => ({ id: `${p.id}`, ...errData })
    })
    await this.callHook('bulkArchive:after', { _ids: entries.map(p => p._id), data, errors, event })

    const results: ReturnType<typeof this.cleanJSON>[] = []
    if (entries.length) {
      const validIds = entries.map(p => p._id)
      let writeFailed = false
      try {
        await this.collection.updateMany({ _id: { $in: validIds } } as any, { $set: data } as any)
      } catch (error) {
        if (!(error instanceof MongoServerError)) throw error
        writeFailed = true
        errors.push({ data: { ids: validIds.map(String) }, error: this.writeErrorMessage(error) })
      }
      // failed updateMany -> unable to tell which if any documents were actually updated -> skip
      if (!writeFailed) {
        // updateMany + find below are two round trips, not one atomic op — a concurrent write to the
        // same document landing between them can leak into `results`.
        const documents = await this.collection.find({ _id: { $in: validIds } } as any).toArray()
        results.push(...documents.map(d => this.cleanJSON(d)))
        const updatedIds = new Set(results.map(j => j.id?.toString()))
        for (const p of entries) {
          if (!updatedIds.has(p._id.toString())) errors.push({ data: { id: `${p.id}` }, error: 'Document not found' })
        }
      }
    }

    await this.settleWithErrors({
      items: results,
      run: json => this.callHook('archive:done', { data: json, event }),
      errors
    })
    await this.callHook('bulkArchive:done', { data: results, event, errors })

    if (ids.length && !results.length) throw createError({ statusCode: 400, statusMessage: 'Bad data', data: { errors } })

    return { results, errors }
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

  /**
   * Delete multiple model instances
   * @param ids array of instance ids
   * @param event incoming request
   */
  async bulkDelete(ids: (string | ObjectId | undefined)[], event?: H3Event) {
    this.assertBulkSize(ids)
    const errors: HookArgErrors['errors'] = []
    // Parse ids, isolating malformed ones as errors instead of aborting the whole batch
    const seenIds = new Set<string>()
    const parsed: { id: string | ObjectId | undefined, _id: ObjectId }[] = []
    for (const id of ids) {
      const _id = this.parseId(id, seenIds, errors)
      if (_id) parsed.push({ id, _id })
    }

    await this.callHook('bulkDelete:before', { ids, _ids: parsed.map(p => p._id), event })

    // Isolate before-hook rejections instead of silently discarding them
    const entries = await this.settleWithErrors({
      items: parsed,
      run: async (p) => {
        await this.callHook('delete:before', { id: p.id, _id: p._id, event })
        return p
      },
      errors,
      errorData: (p, data) => ({ id: `${p.id}`, ...data })
    })

    let deletedCount = 0
    // Fed to bulkDelete:done below — kept separate from `entries` so an id rejected by a
    // delete:document hook or missing from the collection isn't reported there as deleted
    const deletedData: Schema[] = []
    const validIds = entries.map(p => p._id)
    const docsResult = await this.callHookDocuments('delete', validIds, errors, event)
    if (validIds.length) {
      const rejectedIds = docsResult?.rejectedIds ?? new Set<string>()
      // A rejected delete:document hook keeps its document out of the actual delete entirely
      const deletableIds = validIds.filter(_id => !rejectedIds.has(_id.toString()))
      // Know which ids actually exist before deleting, so per-id delete:done/errors reflect reality
      // find + deleteMany below are two round trips, not one atomic op — a concurrent delete of the
      // same id landing between them can make delete:done fire for a document this call didn't delete.
      const documents = docsResult?.documents
        ?? await this.collection.find({ _id: { $in: deletableIds } } as any, { projection: { _id: 1 } }).toArray()
      const existingIds = new Set(documents.map(doc => doc._id.toString()))

      let deleteFailed = false
      try {
        deletedCount = (await this.collection.deleteMany({ _id: { $in: deletableIds } } as any)).deletedCount
      } catch (error) {
        if (!(error instanceof MongoServerError)) throw error
        deleteFailed = true
        errors.push({ data: { ids: deletableIds.map(String) }, error: this.writeErrorMessage(error) })
      }
      // failed deleteMany -> unable to tell which if any documents were actually removed -> skip
      if (!deleteFailed) {
        await this.settleWithErrors({
          items: entries.filter(p => !rejectedIds.has(p._id.toString())),
          run: (p) => {
            if (!existingIds.has(p._id.toString())) {
              errors.push({ data: { id: `${p.id}` }, error: 'Document not found' })
              return
            }
            deletedData.push({ id: p.id })
            return this.callHook('delete:done', { data: { id: p.id }, deletedCount: 1, event })
          },
          errors,
          errorData: (p, data) => data ?? { id: `${p.id}` }
        })
      }
    }
    await this.callHook('bulkDelete:done', { data: deletedData, errors, event })

    if (ids.length && !deletedCount) throw createError({ statusCode: 400, statusMessage: 'Bad data', data: { errors } })
    return { deletedCount, errors }
  }

  private async cursorFindEncrypted(filter: Filter<OaDbItem<T>>, multiple: boolean) {
    const r: WithId<OaDbItem<T>>[] = []
    if (this.cipherKey) {
      const cursor = this.collection.find()
      const paths = Object.keys(filter)
      for await (const doc of cursor) {
        const iv = doc._iv
        if (!iv) continue // not encrypted
        let same = true
        for (let i = 0; i < paths.length && same; i++) {
          const path = paths[i]!
          const decrypted = decrypt(_.get(doc, path), iv, this.cipherKey, cipherAlgo)
          same = JSON.stringify(decrypted) === JSON.stringify(filter[path])
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
