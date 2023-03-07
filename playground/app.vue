<template>
  <div>
    <h1>Tests</h1>
    <p v-if="pending">
      Loading...
    </p>
    <template v-else>
      <ul>
        <li v-for="t in todos" :key="t.id">
          {{ t.text }}
          <button :disabled="t.deletedAt" @click="openTodo(t)">
            ✏️
          </button>
          <button @click="archiveTodo(t)">
            🗃️
          </button>
          <button @click="rmTodo(t)">
            🗑️
          </button>
        </li>
        <li @click="addTodo">
          <button>+ Add a todo</button>
        </li>
      </ul>
      <dialog ref="dialog">
        <json-schema ref="form" v-model="editedTodo" :schema="schema" />
        <menu>
          <button value="cancel" @click="closeTodo">
            Cancel
          </button>
          <button value="default" @click="updateTodo">
            Save
          </button>
        </menu>
      </dialog>
      <button @click="testWithRandomId">
        Delete with random id
      </button>
      <button v-if="todos.length" @click="testWithBadData">
        Update with bad data
      </button>
      <button v-if="todos.length" @click="testWriteReadOnly">
        Update a read only property
      </button>
    </template>
    <pre v-if="msg" :style="{ color: msgColor }">{{ msg }}</pre>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useFetch, useOaSchema } from '#imports'

const schema = useOaSchema('Todo')

const msg = ref(null)
const msgColor = ref('green')
const { data: todos, pending } = await useFetch('/api/todos', { lazy: true })

const randStr = (base = 36) => Math.random().toString(base).slice(3, 9)

const msgWrapper = func => async (d) => {
  msg.value = null
  msgColor.value = 'green'
  const { data, error } = await func(d)
  msg.value = data.value || error.value
  if (error.value) {
    msgColor.value = 'red'
    if (error.value.data?.data) {
      msg.value += '\n' + JSON.stringify(error.value.data.data, '', ' ')
    }
  }
}

const addTodo = msgWrapper(async () => {
  const { data, error } = await useFetch('/api/todos/', { method: 'POST', body: { text: randStr() } })
  if (!error.value) { todos.value.push(data.value) }
  return { data, error }
})

const editedTodo = ref(null)
const dialog = ref(null)
const openTodo = (todo) => {
  dialog.value.showModal()
  editedTodo.value = JSON.parse(JSON.stringify(todo))
}
const closeTodo = () => {
  dialog.value.close()
  editedTodo.value = null
}

const form = ref(null)
const updateTodo = msgWrapper(async () => {
  if (!await form.value.validate()) { return }
  const id = editedTodo.value.id
  const { data, error } = await useFetch('/api/todos/' + id, { method: 'PUT', body: editedTodo.value })
  if (!error.value) { todos.value.splice(todos.value.findIndex(t => t.id === id), 1, data.value) }
  closeTodo()
  return { data, error }
})

const archiveTodo = msgWrapper(async ({ id, deletedAt }) => {
  const { data, error } = await useFetch('/api/todos/' + id + '/archive', { method: 'POST', body: { archive: !deletedAt } })
  if (!error.value) { todos.value.splice(todos.value.findIndex(t => t.id === id), 1, data.value) }
  return { data, error }
})

const rmTodo = msgWrapper(async ({ id }) => {
  const { data, error } = await useFetch('/api/todos/' + id, { method: 'DELETE' })
  if (!error.value) { todos.value.splice(todos.value.findIndex(t => t.id === id), 1) }
  return { data, error }
})

const testWithRandomId = msgWrapper(async () =>
  await useFetch('/api/todos/63cf86ff1541f5505b' + randStr(16), { method: 'DELETE', body: { text: 'U-test' } })
)

const testWithBadData = msgWrapper(async () =>
  await useFetch('/api/todos/' + todos.value[0].id, { method: 'PUT', body: { noInSchema: 'test', text: 'no' } })
)

const testWriteReadOnly = msgWrapper(async () =>
  await useFetch('/api/todos/' + todos.value[0].id, { method: 'PUT', body: { text: todos.value[0].text, readOnlyProp: 'test' } })
)
</script>

<style>
dialog::backdrop {
  background: rgba(0, 0, 0, 0.25);
}
</style>
