<template>
  <div>
    <h1>Tests</h1>
    <p v-if="pending">
      Loading...
    </p>
    <template v-else>
      <button @click="openTodo({ id: 'new', text: '' })">
        + Add a todo
      </button>
      <json-list
        :items="todos"
        :schema="schema"
      >
        <template #table-header="{ sortBy, sortDesc }">
          <div :style="{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '20px', userSelect: 'none' }">
            <span>Text {{ sortBy === 'text' ? (sortDesc ? '↑' : '↓') : '' }}</span>
            <span>Actions</span>
          </div>
        </template>
        <template #item="{ item: t, view }">
          <div
            class="item"
            :style="view === 'card' ? {} : { display: 'grid', gridTemplateColumns: '100px 1fr', alignItems: 'center', gap: '20px' }"
          >
            <p><b>{{ t.text }}</b></p>
            <div>
              <button
                :disabled="t.deletedAt"
                @click="openTodo(t)"
              >
                ✏️
              </button>
              <button @click="archiveTodo(t)">
                🗃️
              </button>
              <button @click="rmTodo(t)">
                🗑️
              </button>
            </div>
          </div>
        </template>
      </json-list>
      <dialog ref="dialog">
        <json-schema
          ref="form"
          v-model="editedTodo"
          :schema="schema"
          :defs-schema="defsSchema"
          :keywords="keywords"
        />
        <menu>
          <button
            value="cancel"
            @click="closeTodo"
          >
            Cancel
          </button>
          <button
            value="default"
            @click="updateTodo"
          >
            Save
          </button>
        </menu>
      </dialog>
      <button @click="testWithRandomId">
        Delete with random id
      </button>
      <button
        v-if="todos.length"
        @click="testWithBadData"
      >
        Update with bad data
      </button>
      <button
        v-if="todos.length"
        @click="testWriteReadOnly"
      >
        Update a read only property
      </button>
    </template>
    <pre
      v-if="msg"
      :style="{ color: msgColor }"
    >{{ msg }}</pre>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { JsonSchema } from 'j2u'
import { keywords } from '~/ajv-keywords'
import { useFetch, useOaSchema, useOaDefsSchema, useNuxtApp } from '#imports'

const schema = useNuxtApp().$getTodoOaSchema
const schema2 = useOaSchema('Todo')
const defsSchema = useOaDefsSchema('defs')

// const s = schema.properties.cost.range
// const s2 = schema2.properties

const msg = ref<string | null>(null)
const msgColor = ref('green')
const { data: todos, pending } = await useFetch('/api/todos', { lazy: true })

const randStr = (base = 36) => Math.random().toString(base).slice(3, 9)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const msgWrapper = <T extends object>(func: (arg: T) => Promise<any>) => async (d: T) => {
  msg.value = null
  msgColor.value = 'green'
  const { data, error } = await func(d)
  msg.value = data?.value || error?.value || ''
  if (error?.value) {
    msgColor.value = 'red'
    if (error.value.data?.data) {
      msg.value += '\n' + JSON.stringify(error.value.data.data, null, ' ')
    }
  }
}

const editedTodo = ref<OaTodo | null>(null)
const dialog = ref<HTMLDialogElement | null>(null)
const openTodo = (todo: OaTodo) => {
  dialog.value?.showModal()
  editedTodo.value = JSON.parse(JSON.stringify(todo))
}
const closeTodo = () => {
  dialog.value?.close()
  editedTodo.value = null
}

const form = ref<InstanceType<typeof JsonSchema> | null>(null)
const updateTodo = msgWrapper(async () => {
  if (!await form.value?.validate()) return {}
  if (!editedTodo.value) return
  const isNew = editedTodo.value.id === 'new'
  const { id, ...body } = editedTodo.value
  const { data, error } = await useFetch(`/api/todos/${isNew ? '' : id}`, {
    method: isNew ? 'POST' : 'PUT', body
  })
  if (!error.value) {
    if (isNew) {
      todos.value.push(data.value)
    } else {
      todos.value.splice(todos.value.findIndex((t: OaTodo) => t.id === id), 1, data.value)
    }
  }
  closeTodo()
  return { data, error }
})

const archiveTodo = msgWrapper(async ({ id, deletedAt }: OaTodo) => {
  const { data, error } = await useFetch('/api/todos/' + id + '/archive', { method: 'POST', body: { archive: !deletedAt } })
  if (!error.value) todos.value.splice(todos.value.findIndex((t: OaTodo) => t.id === id), 1, data.value)
  return { data, error }
})

const rmTodo = msgWrapper(async ({ id }: OaTodo) => {
  const { data, error } = await useFetch('/api/todos/' + id, { method: 'DELETE' })
  if (!error.value) todos.value.splice(todos.value.findIndex((t: OaTodo) => t.id === id), 1)
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
