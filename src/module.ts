import { existsSync, lstatSync, readdirSync, readFileSync } from 'fs'
import { defineNuxtModule, createResolver, addServerHandler, addImports, addPlugin, addPluginTemplate } from '@nuxt/kit'
import consola from 'consola'
import { defu } from 'defu'
import chalk from 'chalk'

import type { RuntimeConfig } from '@nuxt/schema'
import type { ModuleOptions } from './types'

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-oa',
    configKey: 'oa'
  },
  defaults: {
    schemasFolder: 'schemas',
    cipherAlgo: 'aes-256-gcm',
    openApiPath: '/api-doc/openapi.json',
    swaggerPath: '/api-doc'
  },
  async setup (options, nuxt) {
    options = { ...options, ...nuxt.options.runtimeConfig?.oa as ModuleOptions }

    const { resolve } = createResolver(import.meta.url)
    const rootResolver = createResolver(nuxt.options.rootDir)
    const schemasFolderPath = rootResolver.resolve(options.schemasFolder)

    if (!options.dbUrl) {
      throw new Error('[@nuxtjs/oa] dbUrl is required (mongodb connection string)')
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
    nuxt.options.nitro.imports.presets.push({ from: resolve('runtime/server/composables'), imports: ['useDb', 'useCol', 'useObjectId', 'useModel', 'createOaRouter', 'oaHandler', 'oaComponent', 'useGetAll', 'useCreate', 'useUpdate', 'useArchive', 'useDelete'] })

    // Add doc routes
    if (options.openApiPath) {
      addServerHandler({
        route: options.openApiPath,
        handler: resolve('runtime/server/openApiPage')
      })
      if (options.swaggerPath) {
        addServerHandler({
          route: options.swaggerPath,
          handler: resolve('runtime/server/swaggerPage')
        })
        const { withTrailingSlash, withoutTrailingSlash } = await import('ufo')
        nuxt.hook('listen', (_, listener) => {
          const viewerUrl = `${withoutTrailingSlash(listener.url)}${options.swaggerPath}`
          consola.log(`  > Swagger:  ${chalk.underline.cyan(withTrailingSlash(viewerUrl))}\n`)
        })
      }
    }

    // Provide get[ModelName]OaSchema for each schema
    for (const modelName of Object.keys(schemas)) {
      addPluginTemplate({
        filename: `get${modelName}OaSchema.mjs`,
        src: resolve('runtime/plugins/oaSchema.ejs'),
        options: { schemasFolderPath, modelName }
      })
    }

    // Add ajfg (auto form generator)
    addPlugin(resolve('runtime/plugins/ajfg'))
    addImports([
      'useOaSchema'
    ].map(key => ({
      name: key,
      as: key,
      from: resolve('runtime/composables')
    })))
  }
})
