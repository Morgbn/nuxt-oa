import { pathToFileURL } from 'url'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'fs'
import { useLogger, defineNuxtModule, createResolver, addServerHandler, addImports, addPlugin, addPluginTemplate, addTemplate } from '@nuxt/kit'
import chalk from 'chalk'
import genTypes from './typeGenerator'
import type { ModuleOptions, Schema, DefsSchema } from './types'

const logger = useLogger('nuxt-oa')

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

    const schemasByName: Record<string, Schema> = {}
    const schemasFolderPathByName: Record<string, string> = {}
    const defsById: Record<string, DefsSchema> = {}
    for (const layer of nuxt.options._layers) {
      const { oa } = layer.config
      if (oa) {
        if (!options.dbUrl) { options.dbUrl = oa.dbUrl } // earlier = higher priority
        if (!options.openApiPath) { options.openApiPath = oa.openApiPath }
        if (!options.swaggerPath) { options.swaggerPath = oa.swaggerPath }
      }
      const layerResolver = createResolver(layer.cwd)
      const schemasFolderPath = layerResolver.resolve(oa?.schemasFolder ?? options.schemasFolder)
      if (!existsSync(schemasFolderPath)) { continue }
      if (!lstatSync(schemasFolderPath).isDirectory()) { continue }
      const schemasResolver = createResolver(schemasFolderPath)
      for (const file of readdirSync(schemasFolderPath)) { // Read schemas
        const name = file.split('.').slice(0, -1).join('.')
        const schema = JSON.parse(readFileSync(schemasResolver.resolve(file), 'utf-8'))
        if (name === 'defs') { // definitions file
          const { $id, definitions } = schema as DefsSchema
          if (defsById[$id]) { // extends definitions
            for (const key in definitions) {
              if (!defsById[$id].definitions[key]) { // earlier = higher priority -> don't replace previous def
                defsById[$id].definitions[key] = definitions[key]
              }
            }
          } else {
            defsById[$id] = schema
          }
        } else if (!schemasByName[name]) { // schema file, earlier = higher priority
          schemasByName[name] = schema
          schemasFolderPathByName[name] = schemasFolderPath
        }
      }
    }
    const defsSchemas = Object.values(defsById)

    if (!options.dbUrl) {
      logger.warn('@nuxtjs/oa dbUrl is required (mongodb connection string)')
    }

    nuxt.options.alias['#oa'] = pathToFileURL(addTemplate({
      filename: 'oa.mjs',
      write: true,
      getContents: () => `export const config = ${JSON.stringify(options, null, 2)}\n\n` +
      `export const schemasByName = ${JSON.stringify(schemasByName, null, 2)}\n\n` +
      `export const defsSchemas = ${JSON.stringify(defsSchemas, null, 2)}\n`
    }).dst || '').href

    // Transpile runtime
    const { resolve } = createResolver(import.meta.url)
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
          logger.log(`  > Swagger:  ${chalk.underline.cyan(withTrailingSlash(viewerUrl))} ` +
            `${chalk.gray(`${Object.keys(schemasByName).length} schema(s) found`)}\n`)
        })
      }
    }

    // Provide get[ModelName]OaSchema for each schema
    for (const modelName in schemasByName) {
      addPluginTemplate({
        filename: `get${modelName}OaSchema.mjs`,
        src: resolve('runtime/plugins/oaSchema.ejs'),
        options: { schemasFolderPath: schemasFolderPathByName[modelName], modelName }
      })
    }
    // Provide getOaDefsSchema
    addPlugin(addTemplate({
      filename: 'getOaDefsSchema.mjs',
      getContents: () => `import { defineNuxtPlugin } from '#imports'\nconst byId = ${JSON.stringify(defsById)}\nexport default defineNuxtPlugin(() => ({ provide: { getOaDefsSchema: id => byId[id] } }))`
    }).dst)

    // Add j2u (auto form generator)
    addPlugin(resolve('runtime/plugins/j2u'))
    addImports([
      'useOaSchema', 'useOaDefsSchema'
    ].map(key => ({
      name: key,
      as: key,
      from: resolve('runtime/composables')
    })))

    // Add types
    const typesPath = addTemplate({
      filename: 'types/nuxt-oa.d.ts',
      getContents: () => genTypes(schemasByName, defsSchemas)
    }).dst
    nuxt.hook('prepare:types', (options) => {
      options.references.push({ path: typesPath })
    })
  }
})
