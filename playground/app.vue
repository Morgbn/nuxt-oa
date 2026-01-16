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
import { onMounted, ref } from 'vue'
import { JsonSchema } from 'j2u'
import { keywords } from '~/ajv-keywords'
import { useOaSchema, useOaDefsSchema, oaTodoSchema, useNuxtApp } from '#imports'

const schema = useOaSchema('Todo')
// OR: const schema = oaTodoSchema
// OR: const schema = useNuxtApp().$oaTodoSchema
const defsSchema = useOaDefsSchema('defs')

const msg = ref<string | null>(null)
const msgColor = ref('green')
const todos = ref<OaTodo[]>([])
const pending = ref(true)

onMounted(async () => {
  todos.value = await $fetch('/api/todos')
  pending.value = false
})

const randStr = (base = 36) => Math.random().toString(base).slice(3, 9)

const msgWrapper = <T extends object>(func: (arg: T) => Promise<unknown>, finallyFunc?: () => unknown) => async (d: T) => {
  msg.value = null
  msgColor.value = 'green'
  try {
    const data = await func(d)
    msg.value = JSON.stringify(data, null, ' ') || ''
  } catch (error) {
    msgColor.value = 'red'
    msg.value = error instanceof Error ? error.message : String(error)
    if (error && typeof error === 'object' && 'data' in error && error.data && typeof error.data === 'object' && 'data' in error.data) {
      msg.value += '\n' + JSON.stringify(error.data.data, null, ' ')
    }
  } finally {
    finallyFunc?.()
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
  const data = await $fetch<OaTodo>(`/api/todos/${isNew ? '' : id}`, {
    method: isNew ? 'POST' : 'PUT', body
  })
  if (isNew) todos.value.push(data)
  else todos.value.splice(todos.value.findIndex((t: OaTodo) => t.id === id), 1, data)
  return data
}, closeTodo)

const archiveTodo = msgWrapper(async ({ id, deletedAt }: OaTodo) => {
  const data = await $fetch<OaTodo>('/api/todos/' + id + '/archive', { method: 'POST', body: { archive: !deletedAt } })
  todos.value.splice(todos.value.findIndex((t: OaTodo) => t.id === id), 1, data)
  return data
})

const rmTodo = msgWrapper(async ({ id }: OaTodo) => {
  const data = await $fetch('/api/todos/' + id, { method: 'DELETE' })
  todos.value.splice(todos.value.findIndex((t: OaTodo) => t.id === id), 1)
  return data
})

const testWithRandomId = msgWrapper(async () =>
  await $fetch('/api/todos/63cf86ff1541f5505b' + randStr(16), { method: 'DELETE', body: { text: 'U-test' } })
)

const testWithBadData = msgWrapper(async () =>
  await $fetch('/api/todos/' + todos.value[0]?.id, { method: 'PUT', body: { noInSchema: 'test', text: 'no' } })
)

const testWriteReadOnly = msgWrapper(async () =>
  await $fetch('/api/todos/' + todos.value[0]?.id, { method: 'PUT', body: { text: todos.value[0]?.text, readOnlyProp: 'test' } })
)
</script>

<style>
dialog::backdrop {
  background: rgba(0, 0, 0, 0.25);
}
</style>
