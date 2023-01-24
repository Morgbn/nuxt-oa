import { existsSync, lstatSync, readdirSync, readFileSync } from 'fs'
import { defineNuxtModule, createResolver } from '@nuxt/kit'
import { defu } from 'defu'

import type { RuntimeConfig } from '@nuxt/schema'

export interface ModuleOptions {
  schemasFolder: string,
  dbUrl?: string
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-oa',
    configKey: 'oa'
  },
  defaults: {
    schemasFolder: 'schemas'
  },
  setup (options, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    const rootResolver = createResolver(nuxt.options.rootDir)
    const schemasFolderPath = rootResolver.resolve(options.schemasFolder)

    if (!options.dbUrl) {
      throw new Error('[@nuxtjs/oa] Mongodb connection string is required [oa.dbUrl]')
    }

    if (!existsSync(schemasFolderPath)) {
      throw new Error(`[@nuxtjs/oa] Can't find folder "${options.schemasFolder}"`)
    }
    if (!lstatSync(schemasFolderPath).isDirectory()) {
      throw new Error(`[@nuxtjs/oa] "${options.schemasFolder}" is not a folder`)
    }

    nuxt.options.runtimeConfig.oa = defu(nuxt.options.runtimeConfig.oa, options as RuntimeConfig['oa'])

    // Read schemas
    const schemasResolver = createResolver(schemasFolderPath)
    const schemas: Record<string, object> = {}
    for (const file of readdirSync(schemasFolderPath)) {
      const name = file.split('.').slice(0, -1).join('.')
      const schema = JSON.parse(readFileSync(schemasResolver.resolve(file), 'utf-8'))
      schemas[name] = schema
    }
    Object.defineProperty(nuxt.options.runtimeConfig, 'schemas', {
      value: schemas,
      enumerable: true
    })

    // Transpile runtime
    nuxt.options.build.transpile.push(resolve('runtime'))

    // Add server composables like useModel
    nuxt.options.nitro.imports = nuxt.options.nitro.imports || {}
    nuxt.options.nitro.imports.presets = nuxt.options.nitro.imports.presets || []
    nuxt.options.nitro.imports.presets.push({ from: resolve('runtime/server/composables'), imports: ['useDb', 'useCol', 'useObjectId', 'useModel'] })
  }
})
