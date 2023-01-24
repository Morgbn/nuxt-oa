<template>
  <div>
    <h1>Tests</h1>
    <p v-if="pending">
      Loading...
    </p>
    <ul v-else>
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
    <button @click="mustFail">
      Test Bad id
    </button>
    <pre v-if="msg" :style="{ color: msgColor }">{{ msg }}</pre>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useFetch } from '#imports'

const msg = ref(null)
const msgColor = ref('green')
const { data: todos, pending } = await useFetch('/api/todos', { lazy: true })

const addTodo = async () => {
  msg.value = null
  msgColor.value = 'green'
  const { data, error } = await useFetch('/api/todos/', { method: 'POST', body: { text: Math.random().toString(36).slice(3, 9) } })
  msg.value = data.value || error.value
  if (error.value) { msgColor.value = 'red' } else { todos.value.push(data.value) }
}

const updateTodo = async ({ id }) => {
  msg.value = null
  msgColor.value = 'green'
  const { data, error } = await useFetch('/api/todos/' + id, { method: 'PUT', body: { text: 'U-' + Math.random().toString(36).slice(3, 9) } })
  msg.value = data.value || error.value
  if (error.value) { msgColor.value = 'red' } else { todos.value.splice(todos.value.findIndex(t => t.id === id), 1, data.value) }
}

const rmTodo = async ({ id }) => {
  msg.value = null
  msgColor.value = 'green'
  const { data, error } = await useFetch('/api/todos/' + id, { method: 'DELETE' })
  msg.value = data.value || error.value
  if (error.value) { msgColor.value = 'red' } else { todos.value.splice(todos.value.findIndex(t => t.id === id), 1) }
}

const mustFail = async () => {
  msg.value = null
  msgColor.value = 'green'
  const { data, error } = await useFetch('/api/todos/63cf86ff1541f5505b377060', { method: 'DELETE', body: { text: 'U-test' } })
  msg.value = data.value || error.value
  if (error.value) { msgColor.value = 'red' }
}
</script>
