import type { OaModels } from 'nuxt-oa'
import { useNuxtApp } from '#app'
import type { OaDefSchemaKey } from '#build/oa/getOaDefsSchema'

export function useOaSchema(modelName: keyof OaModels) {
  return useNuxtApp()[`$get${modelName}OaSchema`]
}

export function useOaDefsSchema($id: OaDefSchemaKey) {
  return useNuxtApp().$getOaDefsSchema($id)
}
