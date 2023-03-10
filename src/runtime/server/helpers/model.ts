import { randomBytes } from 'node:crypto'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import type { ValidateFunction } from 'ajv'
import type { Collection, ObjectId } from 'mongodb'
import { Hookable } from 'hookable'
import type { Schema } from '../../../types'
import { pluralize } from './pluralize'
import { decrypt, encrypt } from './cipher'
import { config, schemasByName } from '#oa'

const ajv = new Ajv({ removeAdditional: true })
addFormats(ajv)

const cipherAlgo = config.cipherAlgo
const cipherKey = config.cipherKey

export function cleanSchema (schema: Schema): Schema {
  schema.type = 'object' //  type must be object
  delete schema.encryptedProperties
  delete schema.trackedProperties
  delete schema.timestamps
  delete schema.userstamps
  return schema
}

export default class Model extends Hookable {
  name: string
  collection: Collection
  encryptedProps: string[]
  cipherKey: Buffer|undefined
  trackedProps: string[]
  timestamps: { createdAt?: Boolean, updatedAt?: Boolean }
  userstamps: { createdBy?: Boolean, updatedBy?: Boolean, deletedBy?: Boolean }
  schema: Schema
  validator: ValidateFunction

  constructor (name: string) {
    super()
    if (!schemasByName[name]) {
      throw new Error(`Can not found schema "${name}"`)
    }
    this.name = name
    this.collection = useCol(pluralize(name))
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
  }

  /**
   * Validate data against the model schema
   * @param d data
   */
  validate (d: Schema) {
    const valid = this.validator(d)
    if (!valid) {
      const { errors } = this.validator
      throw createError({ statusCode: 400, statusMessage: 'Bad data', data: { errors } })
    }
    this.rmPropsWithAttr(d, 'readOnly')
  }

  /**
   * Removes properties if a given attribute is present in the schema
   * @param d data
   * @param attr the attribute that triggers the deletion
   */
  rmPropsWithAttr (d: Schema, attr: string) {
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
      d[key] = encrypt(d[key], _iv, this.cipherKey, cipherAlgo)
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
   */
  async getAll () {
    const hookClean = await this.callHook('getAll') ?? ((el: object) => this.cleanJSON(el))
    return (await this.collection.find({}).toArray())
      .map(hookClean)
  }

  /**
   * Create a new model instance
   * @param d body (data from user)
   * @param userId user id
   * @param readOnlyData data from application logic
   */
  async create (d: Schema, userId?: string|ObjectId, readOnlyData?: Schema) {
    await this.callHook('create:before', { data: d })

    this.validate(d)
    const data = readOnlyData ? { ...d, ...readOnlyData } : d
    const at = new Date()
    if (this.timestamps.createdAt) { data.createdAt = at }
    if (this.timestamps.updatedAt) { data.updatedAt = at }
    if (this.userstamps.createdBy) { data.createdBy = userId }
    if (this.userstamps.updatedBy) { data.updatedBy = userId }

    await this.callHook('create:after', { data })

    this.encrypt(data)
    const { insertedId } = await this.collection.insertOne(data)
    return this.cleanJSON({ _id: insertedId, ...data })
  }

  /**
   * Update a model instance
   * @param id instance id
   * @param d body (data from user)
   * @param userId user id
   * @param readOnlyData data from application logic
   */
  async update (id: string|ObjectId, d: Schema, userId?: string|ObjectId, readOnlyData?: Schema) {
    const _id = useObjectId(id)
    await this.callHook('update:before', { id, _id, data: d })

    this.validate(d)
    const data = readOnlyData ? { ...d, ...readOnlyData } : d
    if (this.timestamps.updatedAt) { data.updatedAt = new Date() }
    if (this.userstamps.updatedBy) { data.updatedBy = userId }

    const instance = (this.trackedProps.length || this.cipherKey)
      ? await this.collection.findOne({ _id }) as Schema
      : null
    if (this.trackedProps.length && instance) {
      const update = this.trackedProps.reduce((o, key) => ({ ...o, [key]: instance[key] }), {})
      data.updates = [...(instance.updates || []), update]
    }

    await this.callHook('update:after', { id, _id, data })

    if (this.cipherKey && instance) {
      data._iv = instance._iv
      this.encrypt(data)
    }
    const { value } = await this.collection
      .findOneAndUpdate({ _id }, { $set: data }, { returnDocument: 'after' })
    if (!value) {
      throw createError({ statusCode: 404, statusMessage: 'Document not found' })
    }
    return this.cleanJSON(value)
  }

  /**
   * Archive a model instance
   * @param id instance  id
   * @param archive whether to archive or unarchive
   * @param userId user id
   */
  async archive (id: string|ObjectId, archive = true, userId?: string|ObjectId) {
    const _id = useObjectId(id)
    await this.callHook('archive:before', { id, _id })

    const data: Record<string, any> = { deletedAt: archive ? new Date() : undefined }
    if (this.userstamps.deletedBy) { data.deletedBy = archive ? userId : undefined }
    await this.callHook('archive:after', { id, _id, data })

    const { value } = await this.collection
      .findOneAndUpdate({ _id }, { $set: data }, { returnDocument: 'after' })
    if (!value) {
      throw createError({ statusCode: 404, statusMessage: 'Document not found' })
    }
    return this.cleanJSON(value)
  }

  /**
   * Delete a model instance
   * @param id instance id
   */
  async delete (id: string|ObjectId) {
    const _id = useObjectId(id)
    await this.callHook('delete:before', { id, _id })

    const { deletedCount } = await this.collection.deleteOne({ _id })
    return { deletedCount }
  }
}
