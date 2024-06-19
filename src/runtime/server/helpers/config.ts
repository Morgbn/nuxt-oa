import type { ModuleOptions } from '../../types'
// @ts-expect-error : we are importing from the virtual file system
import config from '#oa-config'

export const useOaConfig = () => config as ModuleOptions
