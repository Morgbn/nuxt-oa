import { useNuxtApp } from '#app'
import type { OaDefSchemaKey } from '#build/getOaDefsSchema'
import type { OaModels } from 'nuxt-oa'

export function useOaSchema (modelName: keyof OaModels) {
  return useNuxtApp()[`$get${modelName}OaSchema`]
}

export function useOaDefsSchema ($id: OaDefSchemaKey) {
  return useNuxtApp().$getOaDefsSchema($id)
}
