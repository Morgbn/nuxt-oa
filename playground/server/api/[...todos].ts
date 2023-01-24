const router = createRouter()
const Todo = useModel('Todo')

// get all
router.get('/', defineEventHandler(async () => await Todo.getAll()))

// create
router.post('/', defineEventHandler(async (event) => {
  const body = await readBody(event)
  return await Todo.create(body)
}))

// update
router.put('/:id', defineEventHandler(async (event) => {
  const body = await readBody(event)
  return await Todo.update(event.context.params.id, body)
}))

// delete
router.delete('/:id', defineEventHandler(async (event) => {
  return await Todo.delete(event.context.params.id)
}))

export default useBase('/api/todos', router.handler)
