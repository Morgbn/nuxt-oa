import Ajv from 'ajv'
import addFormats from 'ajv-formats'

import type { ValidateFunction } from 'ajv'
import type { Collection, ObjectId } from 'mongodb'

import { pluralize } from './pluralize'

const ajv = new Ajv({ removeAdditional: true })
addFormats(ajv)

type Schema = { [key: string]: any }
const config = useRuntimeConfig()
const schemas: Record<string, Schema> = config.schemas

export default class Model {
  name: string
  readOnlyProps: string[]
  schema: Schema
  validator: ValidateFunction
  collection: Collection

  constructor (name: string) {
    if (!schemas[name]) {
      throw new Error(`Can not found schema "${name}"`)
    }
    this.name = name
    const schema = schemas[name]
    this.readOnlyProps = Array.isArray(schema.readonly) ? schema.readonly : []
    this.schema = { additionalProperties: false, ...schema } // set additionalProperties to false by default
    delete this.schema.readonly
    this.validator = ajv.compile(this.schema)
    this.collection = useCol(pluralize(name))
  }

  /**
   * Validate data against the model schema
   * @param d data
   */
  validate (d: Schema) {
    const valid = this.validator(d)
    for (const key of this.readOnlyProps) { // remove readOnly properties
      delete d[key]
    }
    if (!valid) {
      const { errors } = this.validator
      throw createError({ statusCode: 400, statusMessage: 'Bad data', data: { errors } })
    }
  }

  /**
   * Clean an object
   *  - remove fields to omit
   *  - replace _id by id
   * @param d representation of a model instance
   */
  cleanJSON (d: any) {
    // TODO
    return { ...d, id: d._id, _id: undefined }
  }

  /**
   * Get all instances of the model
   */
  async getAll () {
    return (await this.collection.find({}).toArray())
      .map(el => this.cleanJSON(el))
  }

  /**
   * Create a new model instance
   * @param d body (data from user)
   * @param readOnlyData data from application logic
   */
  async create (d: Schema, readOnlyData?: Schema) {
    this.validate(d)
    const data = readOnlyData ? { ...d, ...readOnlyData } : d
    const { insertedId } = await this.collection.insertOne(data)
    return this.cleanJSON({ _id: insertedId, ...data })
  }

  /**
   * Update a model instance
   * @param id instance id
   * @param d body (data from user)
   * @param readOnlyData data from application logic
   */
  async update (id: string | ObjectId, d: Schema, readOnlyData?: Schema) {
    const _id = useObjectId(id)
    this.validate(d)
    const data = readOnlyData ? { ...d, ...readOnlyData } : d
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
  async delete (id: string | ObjectId) {
    const _id = useObjectId(id)
    const { deletedCount } = await this.collection.deleteOne({ _id })
    return { deletedCount }
  }
}
