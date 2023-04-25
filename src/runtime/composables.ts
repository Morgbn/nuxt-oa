import { useNuxtApp } from '#app'

export function useOaSchema (modelName: string) {
  return useNuxtApp()[`$get${modelName}OaSchema`]
}

export function useOaDefsSchema ($id: string) {
  // @ts-ignore
  return useNuxtApp().$getOaDefsSchema($id)
}
