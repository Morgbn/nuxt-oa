import JSONSchemaForm from 'ajfg'
import { defineNuxtPlugin } from '#imports'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(JSONSchemaForm)
})
