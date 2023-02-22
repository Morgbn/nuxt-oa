import consola from 'consola'
import { H3Event } from 'h3'

const Todo = useModel('Todo')

const setReadOnlyProp = (d: any) => { d.readOnlyProp = 'privateN=' + (d.privateN ?? 0) }

Todo.hook('create:after', ({ data }) => setReadOnlyProp(data))

Todo.hook('update:after', ({ data }) => setReadOnlyProp(data))

const log = oaHandler((ev: H3Event) => {
  consola.log('log::', ev.node.req.method)
}, (doc: any) => {
  if (!doc) { return }
  doc.summary = `${doc.summary || ''} (and log method)`
})
const log2 = (ev: H3Event) => consola.log('log::', ev.node.req.url)

export default createOaRouter('/api/todos')
  .get('/', log, useGetAll(Todo))
  .post('/', log, log2, useCreate(Todo))
  .post('/:id/archive', useArchive(Todo))
  .put('/:id', useUpdate(Todo))
  .delete('/:id', useDelete(Todo))
