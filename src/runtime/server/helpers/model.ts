import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import type { Collection, ObjectId } from 'mongodb'

import { pluralize } from './pluralize'

const ajv = new Ajv()
addFormats(ajv)

const config = useRuntimeConfig()
const schemas: Record<string, object> = config.schemas

export default class Model {
  name: string
  validator: Function
  collection: Collection

  constructor (name: string) {
    if (!schemas[name]) {
      throw new Error(`Can not found schema "${name}"`)
    }
    this.name = name
    this.validator = ajv.compile(schemas[name])
    this.collection = useCol(pluralize(name))
  }

  /**
   * Validate data against the model schema
   * @param d data
   */
  validate (d: object) {
    const valid = this.validator(d)
    if (!valid) { throw createError({ statusCode: 400, statusMessage: 'Bad data' }) }
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
   * @param d body
   */
  async create (d: object) {
    this.validate(d)
    const { insertedId } = await this.collection.insertOne(d)
    return this.cleanJSON({ _id: insertedId, ...d })
  }

  /**
   * Update a model instance
   * @param id instance id
   * @param d body
   */
  async update (id: string | ObjectId, d: object) {
    const _id = useObjectId(id)
    this.validate(d)
    const { value } = await this.collection
      .findOneAndUpdate({ _id }, { $set: d }, { returnDocument: 'after' })
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
