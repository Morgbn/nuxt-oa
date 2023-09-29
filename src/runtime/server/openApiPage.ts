import { defineEventHandler, setHeader } from 'h3'
import type { Schema } from '../types'
import { cleanSchema } from './helpers/model'
import { paths, components } from './helpers/router'

import { useRuntimeConfig } from '#imports'

const { openApiGeneralInfo, openApiServers, schemasByName, defsSchemas } = useRuntimeConfig().oa

const hasMultiDefsId = defsSchemas.length > 1
const defsComponents = defsSchemas.reduce<Record<string, Schema>>((o, schema) => {
  for (const key in schema.definitions) {
    o[hasMultiDefsId ? `${schema.$id}_${key}` : key] = schema.definitions[key]
  }
  return o
}, {})

const refRe = /("\$ref": ")(\w+)(?:\.\w+)?#(?:\/(\w+))+"/gm
const refSubst = hasMultiDefsId ? '$1#/components/schemas/$2_$3"' : '$1#/components/schemas/$3"'
const schemas = Object.entries(schemasByName)
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
