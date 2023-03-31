import { readBody } from 'h3'
import type { H3Event } from 'h3'

import { useUserId } from '../composables'
import Model from './model'
import { oaHandler } from './router'

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

export const useGetAll = (model: Model, apiDoc = {}) => {
  const { name } = model
  const lowerName = name.toLowerCase()

  return oaHandler(async () => {
    return await model.getAll()
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

export const useCreate = (model: Model, apiDoc = {}) => {
  const { name } = model
  const lowerName = name.toLowerCase()

  return oaHandler(async (event: H3Event) => {
    const body = await readBody(event)
    return await model.create(body, useUserId(event))
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

export const useUpdate = (model: Model, apiDoc = {}) => {
  const { name } = model
  const lowerName = name.toLowerCase()

  return oaHandler(async (event: H3Event) => {
    const body = await readBody(event)
    return await model.update(event.context.params?.id, body, useUserId(event))
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

export const useArchive = (model: Model, apiDoc = {}) => {
  const { name } = model
  const lowerName = name.toLowerCase()

  return oaHandler(async (event: H3Event) => {
    const { archive } = await readBody(event)
    return await model.archive(event.context.params?.id, archive, useUserId(event))
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

export const useDelete = (model: Model, apiDoc = {}) => {
  const { name } = model
  const lowerName = name.toLowerCase()

  return oaHandler(async (event: H3Event) => {
    return await model.delete(event.context.params?.id)
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
