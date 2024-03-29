import { ObjectId } from 'mongodb'
import { consola } from 'consola'
import { H3Event } from 'h3'
import { keywords } from '~/ajv-keywords'

const { addKeywords } = useOaModelAjv() // need to be called before any useOaModel()
addKeywords(keywords)

const Layer = useOaModel('Layer')
consola.log(Layer.name) // model from layer base

const Todo = useOaModel('Todo')

const auth = oaHandler((ev: H3Event) => {
  ev.context.user = { fake_user: true, id: new ObjectId() }
}, {
  security: [{ jwtCookie: [] }]
})

const setReadOnlyProp = (d: any) => { d.readOnlyProp = 'privateN=' + (d.privateN ?? 0) }

Todo.hook('create:after', ({ data }) => setReadOnlyProp(data))

Todo.hook('update:after', ({ data }) => setReadOnlyProp(data))
Todo.hook('archive:done', ({ event }) => consola.log(`Todo #${event?.context.params?.id} archived`))
Todo.hook('update:document', ({ document }) => consola.log(`Todo mongodb document (from findOne) => ${document}`))

const log = oaHandler((ev: H3Event) => {
  consola.log('log::', ev.node.req.method)
}, (doc: any) => {
  if (!doc) { return }
  doc.summary = `${doc.summary || ''} (and log method)`
})
const log2 = (ev: H3Event) => consola.log('log::', ev.node.req.url)

export default createOaRouter('/api/todos')
  .get('/', auth, log, useGetAll(Todo))
  .post('/', auth, log, log2, useCreate(Todo))
  .post('/:id/archive', auth, useArchive(Todo))
  .put('/:id', auth, useUpdate(Todo))
  .delete('/:id', auth, useDelete(Todo))
