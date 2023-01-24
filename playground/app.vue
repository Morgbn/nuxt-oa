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
          <button @click="updateTodo(t)">
            ♻️
          </button>
          <button @click="rmTodo(t)">
            🗑️
          </button>
        </li>
        <li @click="addTodo">
          <button>+ Add a todo</button>
        </li>
      </ul>
      <button @click="testWithRandomId">
        Delete with random id
      </button>
      <button v-if="todos.length" @click="testWithBadData">
        Update with bad data
      </button>
    </template>
    <pre v-if="msg" :style="{ color: msgColor }">{{ msg }}</pre>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useFetch } from '#imports'

const msg = ref(null)
const msgColor = ref('green')
const { data: todos, pending } = await useFetch('/api/todos', { lazy: true })

const randStr = (base = 36) => Math.random().toString(base).slice(3, 9)

const msgWrapper = func => async () => {
  msg.value = null
  msgColor.value = 'green'
  const { data, error } = await func()
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

const updateTodo = msgWrapper(async ({ id }) => {
  const { data, error } = await useFetch('/api/todos/' + id, { method: 'PUT', body: { up: 'U-' + randStr() } })
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
  await useFetch('/api/todos/' + todos.value[0].id, { method: 'PUT', body: { noInSchema: 'test' } })
)
</script>
