import { defineEventHandler, setHeader } from 'h3'
import type { Schema } from '../types'
import { cleanSchema } from './helpers/model'
import { useOaConfig } from './helpers/config'
import { paths, components } from './helpers/router'
import { oaDefsSchemas, oaSchemasByName } from '~/.nuxt/oa/nitro'

const { openApiGeneralInfo, openApiServers } = useOaConfig()

const hasMultiDefsId = oaDefsSchemas.length > 1
const defsComponents = oaDefsSchemas.reduce<Record<string, Schema>>((o, schema) => {
  for (const key in schema.definitions) {
    o[hasMultiDefsId ? `${schema.$id}_${key}` : key] = schema.definitions[key as keyof typeof schema.definitions]
  }
  return o
}, {})

const refRe = /("\$ref": ")(\w+)(?:\.\w+)?#(?:\/(\w+))+"/g
const refSubst = hasMultiDefsId ? '$1#/components/schemas/$2_$3"' : '$1#/components/schemas/$3"'
const schemas = Object.entries(oaSchemasByName)
  .reduce((o: Record<string, Schema>, [key, schema]) => {
    schema = JSON.parse(JSON.stringify(schema, null, 2).replace(refRe, refSubst))
    o[key] = cleanSchema(schema as Schema)
    return o
  }, {})

export default defineEventHandler((event) => {
  setHeader(event, 'Content-Type', 'application/json')
  return {
    openapi: '3.0.0',
    info: openApiGeneralInfo,
    paths,
    components: {
      ...components,
      schemas: {
        ...defsComponents,
        ...schemas
      }
    },
    servers: openApiServers
  }
})
