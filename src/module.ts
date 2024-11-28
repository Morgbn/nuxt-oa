import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { useLogger, defineNuxtModule, createResolver, addServerHandler, addImports, addPlugin, addTemplate, addTypeTemplate, updateTemplates } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'
import chalk from 'chalk'
import { defu } from 'defu'
import genTypes from './schema-helpers'
import type { ModuleOptions, Schema, DefsSchema } from './runtime/types'

const logger = useLogger('nuxt-oa')

const getSchemas = (options: ModuleOptions, nuxt: Nuxt) => {
  // Get schemas & defs
  const schemasByName: Record<string, Schema> = {}
  const defsById: Record<string, DefsSchema> = {}
  for (const layer of nuxt.options._layers) {
    const { oa } = layer.config
    if (oa) {
      if (!options.dbUrl && oa.dbUrl) options.dbUrl = oa.dbUrl // earlier = higher priority
      if (!options.openApiPath && oa.openApiPath) options.openApiPath = oa.openApiPath
      if (!options.swaggerPath && oa.swaggerPath) options.swaggerPath = oa.swaggerPath
    }
    const layerResolver = createResolver(layer.cwd)
    const schemasFolderPath = layerResolver.resolve(oa?.schemasFolder ?? options.schemasFolder)
    if (!existsSync(schemasFolderPath)) continue
    if (!lstatSync(schemasFolderPath).isDirectory()) continue
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
      }
    }
  }
  const defsSchemas = Object.values(defsById)
  return { schemasByName, defsSchemas, defsById }
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-oa',
    configKey: 'oa'
  },
  defaults: {
    dbOptions: {},
    schemasFolder: 'schemas',
    cipherAlgo: 'aes-256-gcm',
    cipherIvSize: 16,
    openApiPath: '/api-doc/openapi.json',
    swaggerPath: '/api-doc',
    cipherKey: '',
    dbUrl: ''
  },
  async setup(options, nuxt) {
    const { schemasByName, defsSchemas, defsById } = getSchemas(options, nuxt)

    // Set up runtime configuration
    nuxt.options.oa = { ...options }
    nuxt.options.runtimeConfig.oa = defu(nuxt.options.runtimeConfig.oa, nuxt.options.oa)

    // Transpile runtime
    const { resolve } = createResolver(import.meta.url)
    nuxt.options.build.transpile.push(resolve('runtime'))

    // Auto import server helpers like useOaModel
    nuxt.options.nitro.imports = nuxt.options.nitro.imports || {}
    nuxt.options.nitro.imports.presets = nuxt.options.nitro.imports.presets || []
    nuxt.options.nitro.imports.presets.push({
      from: resolve('runtime/server/helpers/model'),
      imports: ['useOaModel', 'useOaModelAjv']
    })
    nuxt.options.nitro.imports.presets.push({
      from: resolve('runtime/server/helpers/controllers'),
      imports: ['useUserId', 'useGetAll', 'useCreate', 'useUpdate', 'useArchive', 'useDelete']
    })
    nuxt.options.nitro.imports.presets.push({
      from: resolve('runtime/server/helpers/router'),
      imports: ['createOaRouter', 'oaHandler', 'oaComponent']
    })
    nuxt.options.nitro.imports.presets.push({
      from: resolve('runtime/server/helpers/db'),
      imports: ['useMongoClient', 'useDb', 'useCol', 'useObjectId']
    })
    nuxt.options.nitro.virtual = defu(
      { '#oa-config': () => `export default ${JSON.stringify(nuxt.options.runtimeConfig.oa)}` },
      nuxt.options.nitro.virtual
    )

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
          logger.log(`  ${chalk.yellowBright('➜ Swagger')}:  ${chalk.underline.cyan(withTrailingSlash(viewerUrl))} `
            + `${chalk.gray(`${Object.keys(schemasByName).length} schema(s) found`)}\n`)
        })
      }
    }

    // Provide oa[ModelName]Schema for each schema
    const clientSchemaByName: Record<string, Schema> = {}
    for (const modelName in schemasByName) {
      const schema = JSON.parse(JSON.stringify(schemasByName[modelName]))
      schema.type = 'object'
      delete schema.encryptedProperties
      delete schema.trackedProperties
      delete schema.timestamps
      delete schema.userstamps
      // remove writeOnly props
      if (!schema.writeOnly) {
        const stack: { parent: Schema, key: string, el: Schema }[] = []
        const addToStack = (parent: Schema) => Object.entries(parent).forEach(([key, el]) =>
          (el && typeof el === 'object') ? stack.push({ key, parent, el }) : 0)
        addToStack(schema)
        while (stack.length) {
          const { parent, key, el } = stack.pop()!
          if (el.writeOnly) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete parent[key]
          } else {
            addToStack(el)
          }
        }
      }
      const t = addTemplate({
        filename: `oa/schemas/${modelName}.ts`,
        write: true,
        getContents: () => `export default ${JSON.stringify(schema, null, 2)} as const`
      })
      addImports([{ name: 'default', as: `oa${modelName}Schema`, from: t.dst }])
      addPlugin(addTemplate({
        filename: `oa/plugins/${modelName}.ts`,
        write: true,
        getContents: () => [
          `import { defineNuxtPlugin } from '#imports'`,
          `import oa${modelName}Schema from '${t.dst}'`,
          `export default defineNuxtPlugin((nuxtApp) => ({ provide: { oa${modelName}Schema } }))\n`,
          'declare module "#app" {',
          `  interface NuxtApp { oa${modelName}Schema: typeof oa${modelName}Schema }`,
          '}',
          'declare module "vue" {',
          `  interface ComponentCustomProperties { oa${modelName}Schema: typeof oa${modelName}Schema }`,
          '}'
        ].join('\n')
      }).dst)
      clientSchemaByName[modelName] = schema
    }
    // Provide useOaSchema
    const templateSchema = addTemplate({
      filename: 'oa/useOaSchema.ts',
      write: true,
      getContents: () => [
        'import { useNuxtApp } from "#app"',
        'import type { OaClientSchemas } from "nuxt-oa"',
        '\nexport const useOaSchema = <K extends keyof OaClientSchemas>(modelName: K) => {',
        '  const key = `$oa${modelName}Schema`',
        '  return useNuxtApp()[key] as OaClientSchemas[K]',
        '}'
      ].join('\n')
    })
    addImports([{ name: 'useOaSchema', as: 'useOaSchema', from: templateSchema.dst }])
    // Provide useOaDefsSchema
    const templateDefs = addTemplate({
      filename: 'oa/useOaDefsSchema.ts',
      write: true,
      getContents: () => [
        `const byId = ${JSON.stringify(defsById)} as const`,
        `export type OaDefSchemaKey = keyof typeof byId`,
        `export const useOaDefsSchema = (id: OaDefSchemaKey) => byId[id]`
      ].join('\n')
    })
    addImports([{ name: 'useOaDefsSchema', as: 'useOaDefsSchema', from: templateDefs.dst }])
    // Provide schemas for nitro
    const templateNitro = addTemplate({
      filename: 'oa/nitro.ts',
      write: true,
      getContents: () => [
        `export const oaSchemasByName = ${JSON.stringify(schemasByName)}`,
        `export const oaDefsSchemas = ${JSON.stringify(defsSchemas)}`,
        `export type OaModelName = keyof typeof oaSchemasByName`,
        `export const useOaServerSchema = () => ({ schemasByName: oaSchemasByName, defsSchemas: oaDefsSchemas })`
      ].join('\n')
    })
    nuxt.options.nitro.imports.presets.push({
      from: templateNitro.dst,
      imports: ['oaSchemasByName', 'oaDefsSchemas', 'useOaServerSchema', 'OaModelName']
    })

    // Add j2u (auto form generator)
    addPlugin(resolve('runtime/plugins/j2u'))

    // Add types
    let n = -1
    addTypeTemplate({
      filename: 'types/nuxt-oa.d.ts',
      getContents: () => {
        if (++n) { // on schema update
          const { schemasByName, defsSchemas } = getSchemas(options, nuxt)
          return genTypes(schemasByName, defsSchemas, clientSchemaByName)
        }
        return genTypes(schemasByName, defsSchemas, clientSchemaByName) // first-time
      }
    })
    // On update
    nuxt.hook('builder:watch', (event, path) => {
      if (path.includes(`${options.schemasFolder}/`)) {
        updateTemplates({ filter: t => t.filename === 'types/nuxt-oa.d.ts' })
      }
    })
  }
})
