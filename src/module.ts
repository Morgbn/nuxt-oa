import { pathToFileURL } from 'url'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'fs'
import { defineNuxtModule, createResolver, addServerHandler, addImports, addPlugin, addPluginTemplate, addTemplate } from '@nuxt/kit'
import consola from 'consola'
import chalk from 'chalk'
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
      consola.warn('[@nuxtjs/oa] dbUrl is required (mongodb connection string)')
    }

    if (!existsSync(schemasFolderPath)) {
      throw new Error(`[@nuxtjs/oa] Can't find folder "${options.schemasFolder}"`)
    }
    if (!lstatSync(schemasFolderPath).isDirectory()) {
      throw new Error(`[@nuxtjs/oa] "${options.schemasFolder}" is not a folder`)
    }

    // Read schemas
    const schemasResolver = createResolver(schemasFolderPath)
    const schemasByName: Record<string, object> = {}
    for (const file of readdirSync(schemasFolderPath)) {
      const name = file.split('.').slice(0, -1).join('.')
      const schema = JSON.parse(readFileSync(schemasResolver.resolve(file), 'utf-8'))
      schemasByName[name] = schema
    }

    nuxt.options.alias['#oa'] = pathToFileURL(addTemplate({
      filename: 'oa.mjs',
      write: true,
      getContents: () => `export const config = ${JSON.stringify(options, null, 2)}\n\n` +
      `export const schemasByName = ${JSON.stringify(schemasByName, null, 2)}\n`
    }).dst || '').href

    // Transpile runtime
    nuxt.options.build.transpile.push(resolve('runtime'))

    // Add server composables like useModel
    nuxt.options.nitro.imports = nuxt.options.nitro.imports || {}
    nuxt.options.nitro.imports.presets = nuxt.options.nitro.imports.presets || []
    nuxt.options.nitro.imports.presets.push({ from: resolve('runtime/server/composables'), imports: ['useDb', 'useCol', 'useObjectId', 'useModel', 'createOaRouter', 'oaHandler', 'oaComponent', 'useGetAll', 'useCreate', 'useUpdate', 'useArchive', 'useDelete', 'useUserId'] })

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
    for (const modelName of Object.keys(schemasByName)) {
      addPluginTemplate({
        filename: `get${modelName}OaSchema.mjs`,
        src: resolve('runtime/plugins/oaSchema.ejs'),
        options: { schemasFolderPath, modelName }
      })
    }

    // Add j2u (auto form generator)
    addPlugin(resolve('runtime/plugins/j2u'))
    addImports([
      'useOaSchema'
    ].map(key => ({
      name: key,
      as: key,
      from: resolve('runtime/composables')
    })))
  }
})
