import { createError, readBody } from 'h3'
import type { H3Event } from 'h3'
import type { ObjectId } from 'mongodb'
import type Model from './model'
import { oaHandler } from './router'
import type { OaModelName } from '~/.nuxt/oa/nitro'

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

export function useUserId(event: H3Event): string | ObjectId {
  if (!event.context.user?.id) {
    throw createError({ statusCode: 400, statusMessage: 'No user.id in event.context' })
  }
  return event.context.user.id
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
