import { consola } from 'consola'
import type { Schema, DefsSchema } from './runtime/types'
import { addStampProps, updatesDescription } from './runtime/stamps'

type Stack = [Schema, string][]
/** Type generation context: `json` = serialized (client) types, otherwise db/server types */
type Ctx = { prefix: 'Json' | 'Db', json: boolean }
const ctxs: Ctx[] = [{ prefix: 'Json', json: true }, { prefix: 'Db', json: false }]

const genericTypeHelpers = `
type _Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };
type _XOR<T, U> = T | U extends object
  ? (_Without<T, U> & U) | (_Without<U, T> & T)
  : T | U;
type OneOf<T extends readonly any[]> = T extends readonly [infer First, ...infer Rest]
  ? Rest extends readonly [any, ...any[]]
    ? _XOR<First, OneOf<Rest>>
    : First
  : never;`

const capFirst = (str: string) => str[0].toUpperCase() + str.slice(1)
const jsonKey = (str: string) => str.match(/\W/g) ? `'${str}'` : str

const refRe = /(\w+)(?:\.\w+)?#(?:\/(\w+))+/
const refTypeName = (ref: string, ctx: Ctx) => {
  const [, defName, keyName] = ref.match(refRe)!
  return `Oa${ctx.prefix}${capFirst(defName)}${capFirst(keyName)}`
}
function simplestType(schema: Schema, interfaceName: string, stack: Stack, ctx: Ctx): string {
  const suffix = (schema.nullable && !schema.enum) ? '|null' : '' // null must be explicitly included in the list of enum values, see: https://github.com/OAI/OpenAPI-Specification/blob/main/proposals/2019-10-31-Clarify-Nullable.md#if-a-schema-specifies-nullable-true-and-enum-1-2-3-does-that-schema-allow-null-values-see-1900
  if (schema.$ref) {
    return `${refTypeName(schema.$ref, ctx)}${suffix}`
  }
  if (schema.properties || schema.additionalProperties || schema.enum || schema.anyOf || schema.oneOf || schema.allOf || schema.not) {
    stack.push([schema, interfaceName])
    return `${interfaceName}${suffix}`
  }
  if (schema.format === 'date' || schema.format === 'date-time') {
    return `${schema.type ?? 'string'}${ctx.json ? '' : '|Date'}${suffix}`
  }
  if (schema.format === 'objectid') {
    return `string${ctx.json ? '' : `|import('mongodb').ObjectId`}${suffix}`
  }
  return `${schema.type ?? 'any'}${suffix}`
}
function dicType(schema: Schema, interfaceName: string, stack: Stack, ctx: Ctx): string {
  const dicType = simplestType(schema.additionalProperties, `${interfaceName}Item`, stack, ctx)
  const requiredKeys: string[] = ['string']

  if (schema.properties) {
    for (const key of Object.keys(schema.properties)) {
      const sc = schema.properties[key]
      const type = simplestType(sc, `${interfaceName}Item`, [], ctx)
      if (type !== dicType) {
        throw new Error(`${interfaceName} properties types must be the same as additionalProperties`)
      }
      if (schema.required?.includes(key)) {
        requiredKeys.push(jsonKey(key))
      }
    }
  }
  return `Record<${requiredKeys.join('|')}, ${dicType}|undefined>${schema.nullable ? '|null' : ''}`
}

function genInterface(schema: Schema, interfaceName: string, stack: Stack, ctx: Ctx): string {
  let str = `\ninterface ${interfaceName} {\n`

  for (const propName in schema.properties) {
    const propSchema = schema.properties[propName]
    if (propSchema.description) {
      str += `  /**${['', ...propSchema.description.trim().split('\n')].join('\n   * ')}\n   */\n`
    }
    // readOnly = not writable by the client; server code (e.g. hooks) sets it
    str += `  ${propSchema.readOnly && ctx.json ? 'readonly ' : ''}${jsonKey(propName)}${schema.required?.includes(propName) ? '' : '?'}: `

    const propInterfaceName = `${interfaceName}${capFirst(propName.replace(/\W/g, ''))}`
    if (propSchema.type === 'array') {
      const itemInterfaceName = `${propInterfaceName}Item`
      if (Array.isArray(propSchema.items)) {
        const items = propSchema.items
          .map((item: Schema, i: number) => simplestType(item, itemInterfaceName + i, stack, ctx))
        str += `[${items.join(', ')}]`
      } else if (typeof propSchema.items === 'object') {
        const t = simplestType(propSchema.items, itemInterfaceName, stack, ctx)
        str += `${t.includes('|') ? `(${t})` : t}[]`
      }
      if (propSchema.nullable) {
        str += '|null'
      }
    } else if (propSchema.type === 'object' && typeof propSchema.additionalProperties === 'object' && Object.keys(propSchema.additionalProperties).length) {
      str += dicType(propSchema, propInterfaceName, stack, ctx)
    } else {
      str += simplestType(propSchema, propInterfaceName, stack, ctx)
    }
    str += '\n'
  }
  return str + '}\n'
}

/** `not` sub-schema fully described by its TS type (no extra constraint like `minLength`, `required`…), so `Exclude` is exact */
const notKeys = new Set(['type', 'enum'])
const isTypeOnly = (schema: Schema) => Object.keys(schema).every(k => notKeys.has(k))

function genType(schema: Schema, interfaceName: string, stack: Stack, ctx: Ctx) {
  const decl = `type ${interfaceName} = `
  if (schema.additionalProperties && Object.keys(schema.additionalProperties).length) {
    return `${decl}${dicType(schema, interfaceName, stack, ctx)}`
  }
  if (schema.$ref) {
    return `${decl}${refTypeName(schema.$ref, ctx)}${(schema.nullable && !schema.enum) ? '|null' : ''}`
  }
  let str = ''
  if (schema.enum) {
    str += schema.enum
      .map((v: unknown) => v === null ? `${v}` : typeof v === 'number' ? v : `'${v}'`)
      .join(' | ')
  } else {
    str += schema.type ?? 'unknown'
  }
  if (schema.anyOf) { // validates the value against any (one or more) of the sub-schemas
    const anyOf = []
    for (let i = 0; i < schema.anyOf.length; i++) {
      const propertyInterfaceName = `${interfaceName}Item${i}`
      stack.push([schema.anyOf[i], propertyInterfaceName])
      anyOf.push(propertyInterfaceName)
    }
    str += ` & (${anyOf.join(' | ')})`
  }
  if (schema.oneOf) { // validates the value against exactly one of the sub-schemas
    const oneOf = []
    for (let i = 0; i < schema.oneOf.length; i++) {
      const propertyInterfaceName = `${interfaceName}Item${i}`
      stack.push([schema.oneOf[i], propertyInterfaceName])
      oneOf.push(propertyInterfaceName)
    }
    str += ` & OneOf<[${oneOf.join(', ')}]>`
  }
  if (schema.allOf) { // validates the value against all the sub-schemas
    const allOf = []
    for (let i = 0; i < schema.allOf.length; i++) {
      const propertyInterfaceName = `${interfaceName}Item${i}`
      stack.push([schema.allOf[i], propertyInterfaceName])
      allOf.push(propertyInterfaceName)
    }
    str += ` & ${allOf.join(' & ')}`
  }
  // TS has no negated types: only `Exclude` exactly-typed `not` (e.g. `{ type: 'null' }`, `{ enum: [...] }`), otherwise ignore it (runtime-only check)
  if (schema.not && isTypeOnly(schema.not)) {
    const notName = `${interfaceName}Not`
    stack.push([schema.not, notName])
    return `${decl}Exclude<${str}, ${notName}>`
  }
  return decl + str
}

function genTypes(schema: Schema, interfaceName: string, ctx: Ctx) {
  const stack: Stack = [[schema, interfaceName]]

  const types = []
  while (stack.length) {
    const [schema, interfaceName] = stack.shift()!
    if (schema.properties) {
      types.push(genInterface(schema, interfaceName, stack, ctx))
    } else {
      types.push(genType(schema, interfaceName, stack, ctx))
    }
  }

  return types.join('\n')
}

/** Add id, timestamps / userstamps, replace trackedProperties… */
function cleanSchema(schema: Schema, typeName: string) {
  const { trackedProps } = addStampProps(schema)
  if (trackedProps.length) {
    schema.properties.updates = {
      description: updatesDescription,
      type: `Pick<${typeName}, ${trackedProps.map(prop => `'${prop}'`).join(' | ')}>[]`
    }
  }
  delete schema.timestamps
  delete schema.userstamps
  delete schema.trackedProperties
  delete schema.encryptedProperties
  delete schema.maxBulkSize

  return schema
}

/** [type name without `Oa${prefix}`, def schema] pairs */
const defsTypeNames = (defsSchemas: DefsSchema[]) => defsSchemas.flatMap(({ $id, definitions }) => {
  const name = capFirst($id.split('/').pop() as string)
  return Object.keys(definitions).map(key => [`${name}${capFirst(key)}`, definitions[key]] as const)
})

function typeGenerator(schemasByName: Record<string, Schema>, defsSchemas: DefsSchema[] = [], clientSchemaPaths: Record<string, string> = {}): string {
  const allTypes = ['']
  const modelNames = Object.keys(schemasByName)
  const defs = defsTypeNames(defsSchemas)

  for (const ctx of ctxs) {
    for (const modelName of modelNames) {
      const typeName = `Oa${ctx.prefix}${modelName}`
      const schema = cleanSchema(JSON.parse(JSON.stringify(schemasByName[modelName])), typeName)
      allTypes.push(genTypes(schema, typeName, ctx))
    }
    for (const [name, def] of defs) {
      allTypes.push(genTypes(def, `Oa${ctx.prefix}${name}`, ctx))
    }
  }

  return [
    '// Generated by nuxt-oa',
    genericTypeHelpers,
    allTypes.join('\n'),
    // Client schemas: reference generated files instead of inlining JSON
    'type _OaWritable<T> = { -readonly [K in keyof T]: _OaWritable<T[K]> }',
    // Associate all models to their types
    '\ndeclare module "nuxt-oa" {',
    ...ctxs.flatMap(({ prefix }) => [
      `  interface Oa${prefix}Models {`,
      ...modelNames.map(name => `    ${name}: Oa${prefix}${name}`),
      '  }'
    ]),
    '  interface OaClientSchemas {',
    ...Object.entries(clientSchemaPaths).map(([name, path]) => `    ${name}: _OaWritable<typeof import('${path}').default>`),
    '  }',
    `  type OaModelName = keyof OaDbModels`,
    '}'
  ].join('\n')
}

/** Context-dependent aliases (e.g. `OaTodo` = `OaJsonTodo` in app, `OaDbTodo` in server) */
export function aliasTypes(schemasByName: Record<string, Schema>, defsSchemas: DefsSchema[], prefix: Ctx['prefix']): string {
  const names = [...Object.keys(schemasByName), ...defsTypeNames(defsSchemas).map(([name]) => name)]
  return [
    '// Generated by nuxt-oa',
    ...names.map(name => `type Oa${name} = Oa${prefix}${name}`),
    `type OaModels = import('nuxt-oa').Oa${prefix}Models`,
    `type OaModelName = import('nuxt-oa').OaModelName`,
    'declare module "nuxt-oa" {',
    `  interface OaModels extends Oa${prefix}Models {}`,
    '}'
  ].join('\n')
}

export default function typeGeneratorCatchError(schemasByName: Record<string, Schema>, defsSchemas: DefsSchema[] = [], clientSchemaPaths: Record<string, string> = {}): string {
  try {
    return typeGenerator(schemasByName, defsSchemas, clientSchemaPaths)
  } catch (error) {
    consola.error(error)
    return '/* An error occurred */'
  }
}
