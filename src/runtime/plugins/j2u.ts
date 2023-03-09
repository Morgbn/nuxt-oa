import JSONSchemaForm from 'j2u'
import { defineNuxtPlugin } from '#imports'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(JSONSchemaForm)
})
