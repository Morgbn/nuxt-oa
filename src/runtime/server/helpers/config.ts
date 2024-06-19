import type { ModuleOptions } from '../../types'
// @ts-expect-error : we are importing from the virtual file system
import config from '#oa-config'
import { useRuntimeConfig } from '#imports'

export const useOaConfig = (): ModuleOptions => ({ ...config, ...useRuntimeConfig().oa })
