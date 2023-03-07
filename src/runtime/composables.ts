import { useNuxtApp } from '#app'

export function useOaSchema (modelName: string) {
  return useNuxtApp()[`$get${modelName}OaSchema`]
}
