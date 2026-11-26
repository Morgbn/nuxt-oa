import { createError, readBody } from 'h3'
import type { H3Event } from 'h3'
import type { ObjectId } from 'mongodb'
import { useObjectId } from './db'
import type Model from './model'
import { oaHandler } from './router'
import type { OaModelName } from 'nuxt-oa'

const instance200 = (name: string) => ({
  description: `Updated ${name.toLowerCase()}.`,
  content: {
    'application/json': {
      schema: { $ref: `#/components/schemas/${name}` }
    }
  }
})

const modelIdInPath = (name: string) => ({
  in: 'path',
  name: 'id',
  schema: {
    type: 'string'
  },
  required: true,
  description: `Object Id of the ${name.toLowerCase()}`
})

const isString = (value: unknown): value is string => typeof value === 'string'
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isBulkUpdateItem = (value: unknown): value is { id: string, d: Record<string, unknown> } =>
  isPlainObject(value) && isString(value.id) && isPlainObject(value.d)

function validateBulkArray(value: unknown, maxBulkSize: number, itemIsValid: (item: unknown) => boolean, statusMessage: string) {
  if (!Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage })
  }
  if (value.length > maxBulkSize) {
    throw createError({ statusCode: 400, statusMessage: 'Too many items', data: { max: maxBulkSize, received: value.length } })
  }
  if (!value.every(itemIsValid)) {
    throw createError({ statusCode: 400, statusMessage })
  }
}

export function useUserId(event: H3Event): ObjectId {
  const id = event.context.user?.id
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'No user.id in event.context' })
  }
  return useObjectId(id)
}

export const useGetAll = <T extends OaModelName>(model: Model<T>, apiDoc = {}) => {
  const { name } = model
  const lowerName = name.toLowerCase()

  return oaHandler(async (event: H3Event) => {
    return await model.getAll(event)
  }, {
    tags: [name],
    summary: `Get all ${lowerName}`,
    operationId: `getAll${name}`,
    responses: {
      200: {
        description: `List of ${lowerName}.`,
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: {
                $ref: `#/components/schemas/${name}`
              }
            }
          }
        }
      }
    },
    ...apiDoc
  })
}

export const useCreate = <T extends OaModelName>(model: Model<T>, apiDoc = {}) => {
  const { name } = model
  const lowerName = name.toLowerCase()

  return oaHandler(async (event: H3Event) => {
    const body = await readBody(event)
    return await model.create(body, useUserId(event), null, event)
  }, {
    tags: [name],
    summary: `Create ${lowerName}`,
    operationId: `create${name}`,
    requestBody: {
      content: {
        'application/json': {
          schema: {
            $ref: `#/components/schemas/${name}`
          }
        }
      }
    },
    responses: {
      200: instance200(name)
    },
    ...apiDoc
  })
}

export const useBulkCreate = <T extends OaModelName>(model: Model<T>, apiDoc = {}) => {
  const { name } = model
  const lowerName = name.toLowerCase()

  return oaHandler(async (event: H3Event) => {
    const body = await readBody(event)
    validateBulkArray(body, model.maxBulkSize, isPlainObject, 'Body must be an array of objects')
    return await model.bulkCreate(body, useUserId(event), null, event)
  }, {
    tags: [name],
    summary: `Bulk create ${lowerName}`,
    operationId: `bulkCreate${name}`,
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'array',
            items: {
              $ref: `#/components/schemas/${name}`
            }
          }
        }
      }
    },
    responses: {
      200: {
        description: `Results and potential errors for ${lowerName} creation.`,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                results: {
                  type: 'array',
                  items: {
                    $ref: `#/components/schemas/${name}`
                  }
                },
                errors: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          index: { type: 'number' }
                        }
                      },
                      error: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    ...apiDoc
  })
}

export const useUpdate = <T extends OaModelName>(model: Model<T>, apiDoc = {}) => {
  const { name } = model
  const lowerName = name.toLowerCase()

  return oaHandler(async (event: H3Event) => {
    const body = await readBody(event)
    return await model.update(event.context.params?.id, body, useUserId(event), null, event)
  }, {
    tags: [name],
    summary: `Update ${lowerName}`,
    operationId: `update${name}`,
    parameters: [modelIdInPath(name)],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            $ref: `#/components/schemas/${name}`
          }
        }
      }
    },
    responses: {
      200: instance200(name)
    },
    ...apiDoc
  })
}

export const useBulkUpdate = <T extends OaModelName>(model: Model<T>, apiDoc = {}) => {
  const { name } = model
  const lowerName = name.toLowerCase()

  return oaHandler(async (event: H3Event) => {
    const body = await readBody(event)
    validateBulkArray(body, model.maxBulkSize, isBulkUpdateItem, 'Body must be an array of { id: string, d: object }')
    return await model.bulkUpdate(body, useUserId(event), null, event)
  }, {
    tags: [name],
    summary: `Bulk update ${lowerName}`,
    operationId: `bulkUpdate${name}`,
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                d: { $ref: `#/components/schemas/${name}` }
              },
              required: ['id', 'd']
            }
          }
        }
      }
    },
    responses: {
      200: {
        description: `Results and potential errors for ${lowerName} update.`,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                results: {
                  type: 'array',
                  items: {
                    $ref: `#/components/schemas/${name}`
                  }
                },
                errors: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' }
                        }
                      },
                      error: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    ...apiDoc
  })
}

export const useArchive = <T extends OaModelName>(model: Model<T>, apiDoc = {}) => {
  const { name } = model
  const lowerName = name.toLowerCase()

  return oaHandler(async (event: H3Event) => {
    const { archive } = await readBody(event)
    return await model.archive(event.context.params?.id, archive, useUserId(event), event)
  }, {
    tags: [name],
    summary: `Archive ${lowerName}`,
    operationId: `archive${name}`,
    parameters: [modelIdInPath(name)],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              archive: { type: 'boolean' }
            }
          }
        }
      }
    },
    responses: {
      200: instance200(name)
    },
    ...apiDoc
  })
}

export const useBulkArchive = <T extends OaModelName>(model: Model<T>, apiDoc = {}) => {
  const { name } = model
  const lowerName = name.toLowerCase()

  return oaHandler(async (event: H3Event) => {
    const body = await readBody(event)
    validateBulkArray(body?.ids, model.maxBulkSize, isString, 'body ids must be an array of strings')
    return await model.bulkArchive(body?.ids, body?.archive, useUserId(event), event)
  }, {
    tags: [name],
    summary: `Bulk archive ${lowerName}`,
    operationId: `bulkArchive${name}`,
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              ids: { type: 'array', items: { type: 'string' } },
              archive: { type: 'boolean' }
            },
            required: ['ids']
          }
        }
      }
    },
    responses: {
      200: {
        description: `Results and potential errors for ${lowerName} archive.`,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                results: {
                  type: 'array',
                  items: {
                    $ref: `#/components/schemas/${name}`
                  }
                },
                errors: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' }
                        }
                      },
                      error: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    ...apiDoc
  })
}

export const useDelete = <T extends OaModelName>(model: Model<T>, apiDoc = {}) => {
  const { name } = model
  const lowerName = name.toLowerCase()

  return oaHandler(async (event: H3Event) => {
    return await model.delete(event.context.params?.id, event)
  }, {
    tags: [name],
    summary: `Delete ${lowerName}`,
    operationId: `delete${name}`,
    parameters: [modelIdInPath(name)],
    responses: {
      200: {
        description: 'message if success',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                deletedCount: {
                  type: 'string',
                  default: 1
                }
              }
            }
          }
        }
      }
    },
    ...apiDoc
  })
}

export const useBulkDelete = <T extends OaModelName>(model: Model<T>, apiDoc = {}) => {
  const { name } = model
  const lowerName = name.toLowerCase()

  return oaHandler(async (event: H3Event) => {
    const body = await readBody(event)
    validateBulkArray(body?.ids, model.maxBulkSize, isString, 'body ids must be an array of strings')
    return await model.bulkDelete(body?.ids, event)
  }, {
    tags: [name],
    summary: `Bulk delete ${lowerName}`,
    operationId: `bulkDelete${name}`,
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              ids: { type: 'array', items: { type: 'string' } }
            },
            required: ['ids']
          }
        }
      }
    },
    responses: {
      200: {
        description: `Deleted count and potential errors for ${lowerName} deletion.`,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                deletedCount: {
                  type: 'number'
                },
                errors: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' }
                        }
                      },
                      error: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    ...apiDoc
  })
}
