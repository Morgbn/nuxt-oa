import consola from 'consola'
import { H3Event } from 'h3'

const Todo = useModel('Todo')

Todo.hook('update:after', ({ data }) => {
  data.propAddedOnHook = 'update:after'
})

const log = oaHandler((ev: H3Event) => {
  consola.log('log::', ev.node.req.method)
}, (doc: any) => {
  if (!doc) { return }
  doc.summary = `${doc.summary || ''} (and log method)`
})
const log2 = (ev: H3Event) => consola.log('log::', ev.node.req.url)

const instance200 = {
  description: 'Updated todo.',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Todo' }
    }
  }
}

const todoIdInPath = {
  in: 'path',
  name: 'id',
  schema: {
    type: 'string'
  },
  required: true,
  description: 'Object Id of the todo'
}

const getAll = oaHandler(async () => {
  return await Todo.getAll()
}, {
  tags: ['Todo'],
  summary: 'Get all todo',
  operationId: 'getAllTodo',
  responses: {
    200: {
      description: 'List of todo.',
      content: {
        'application/json': {
          schema: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/Todo'
            }
          }
        }
      }
    }
  }
})

const create = oaHandler(async (event: H3Event) => {
  const body = await readBody(event)
  body.privateN = 0
  return await Todo.create(body)
}, {
  tags: ['Todo'],
  summary: 'Create todo',
  operationId: 'createTodo',
  requestBody: {
    content: {
      'application/json': {
        schema: {
          $ref: '#/components/schemas/Todo'
        }
      }
    }
  },
  responses: {
    200: instance200
  }
})

const update = oaHandler(async (event: H3Event) => {
  const body = await readBody(event)
  body.privateN = Math.round(Math.random() * 100)
  return await Todo.update(event.context.params.id, body)
}, {
  tags: ['Todo'],
  summary: 'Update todo',
  operationId: 'updateTodo',
  parameters: [todoIdInPath],
  requestBody: {
    content: {
      'application/json': {
        schema: {
          $ref: '#/components/schemas/Todo'
        }
      }
    }
  },
  responses: {
    200: instance200
  }
})

const archive = oaHandler(async (event: H3Event) => {
  const { archive } = await readBody(event)
  return await Todo.archive(event.context.params.id, archive)
}, {
  tags: ['Todo'],
  summary: 'Archive todo',
  operationId: 'archiveTodo',
  parameters: [todoIdInPath],
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
    200: instance200
  }
})

const remove = oaHandler(async (event: H3Event) => {
  return await Todo.delete(event.context.params.id)
}, {
  tags: ['Todo'],
  summary: 'Delete todo',
  operationId: 'deleteTodo',
  parameters: [todoIdInPath],
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
  }
})

export default createOaRouter('/api/todos')
  .get('/', log, getAll)
  .post('/', log, log2, create)
  .post('/:id/archive', archive)
  .put('/:id', update)
  .delete('/:id', remove)
