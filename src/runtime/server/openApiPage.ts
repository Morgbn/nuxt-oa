import { defineEventHandler, setHeader } from 'h3'
import type { Schema } from '../../types'
import { cleanSchema } from './helpers/model'
import { paths, components } from './helpers/router'
import { config, schemasByName } from '#oa'

const schemas = Object.entries(schemasByName)
  .reduce((o: Record<string, Schema>, [key, schema]) => {
    o[key] = cleanSchema({ ...schema as Schema })
    return o
  }, {})

export default defineEventHandler((event) => {
  setHeader(event, 'Content-Type', 'application/json')
  return {
    openapi: '3.0.0',
    info: config?.openApiGeneralInfo,
    paths,
    components: {
      ...components,
      schemas
    },
    servers: config?.openApiServers
  }
})
