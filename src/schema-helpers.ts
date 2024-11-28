import { consola } from 'consola'
import type { Schema, DefsSchema } from './runtime/types'

type Stack = [Schema, string][]

const genericTypeHelpers = `
type _AllKeys<T> = T extends unknown ? keyof T : never
type _Id<T> = T extends infer U ? { [K in keyof U]: U[K] } : never
type _ExclusiveUnion<T, K extends PropertyKey> =
    T extends unknown ? _Id<T & Partial<Record<Exclude<K, keyof T>, never>>> : never
type OneOf<T> = _ExclusiveUnion<T, _AllKeys<T>>`

const capFirst = (str: string) => str[0].toUpperCase() + str.slice(1)
const jsonKey = (str: string) => str.match(/\W/g) ? `'${str}'` : str

const refRe = /(\w+)(?:\.\w+)?#(?:\/(\w+))+/
function simplestType(schema: Schema, interfaceName: string, stack: Stack): string {
  const suffix = (schema.nullable && !schema.enum) ? '|null' : '' // null must be explicitly included in the list of enum values, see: https://github.com/OAI/OpenAPI-Specification/blob/main/proposals/2019-10-31-Clarify-Nullable.md#if-a-schema-specifies-nullable-true-and-enum-1-2-3-does-that-schema-allow-null-values-see-1900
  if (schema.$ref) {
    const [, defName, keyName] = schema.$ref.match(refRe)
    return `Oa${capFirst(defName)}${capFirst(keyName)}${suffix}`
  }
  if (schema.properties || schema.additionalProperties || schema.enum || schema.anyOf || schema.oneOf || schema.allOf || schema.not) {
    stack.push([schema, interfaceName])
    return `${interfaceName}${suffix}`
  }
  if (schema.format === 'date' || schema.format === 'date-time') {
    return `${schema.type ?? 'string'}|Date${suffix}`
  }
  return `${schema.type ?? 'any'}${suffix}`
}
function dicType(schema: Schema, interfaceName: string, stack: Stack): string {
  const dicType = simplestType(schema.additionalProperties, `${interfaceName}Item`, stack)
  const requiredKeys: string[] = ['string']

  if (schema.properties) {
    for (const key of Object.keys(schema.properties)) {
      const sc = schema.properties[key]
      const type = simplestType(sc, `${interfaceName}Item`, [])
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

function genInterface(schema: Schema, interfaceName: string, stack: Stack): string {
  let str = `\ninterface ${interfaceName} {\n`

  for (const propName in schema.properties) {
    const propSchema = schema.properties[propName]
    if (propSchema.description) {
      str += `  /**${['', ...propSchema.description.trim().split('\n')].join('\n   * ')}\n   */\n`
    }
    str += `  ${propSchema.readOnly ? 'readonly ' : ''}${jsonKey(propName)}${schema.required?.includes(propName) ? '' : '?'}: `

    const propInterfaceName = `${interfaceName}${capFirst(propName.replace(/\W/g, ''))}`
    if (propSchema.type === 'array') {
      const itemInterfaceName = `${propInterfaceName}Item`
      if (Array.isArray(propSchema.items)) {
        const items = propSchema.items
          .map((item: Schema, i: number) => simplestType(item, itemInterfaceName + i, stack))
        str += `[${items.join(', ')}]`
      } else if (typeof propSchema.items === 'object') {
        const t = simplestType(propSchema.items, itemInterfaceName, stack)
        str += `${t.includes('|') ? `(${t})` : t}[]`
      }
      if (propSchema.nullable) {
        str += '|null'
      }
    } else if (propSchema.type === 'object' && typeof propSchema.additionalProperties === 'object' && Object.keys(propSchema.additionalProperties).length) {
      str += dicType(propSchema, propInterfaceName, stack)
    } else {
      str += simplestType(propSchema, propInterfaceName, stack)
    }
    str += '\n'
  }
  return str + '}\n'
}

function genType(schema: Schema, interfaceName: string, stack: Stack) {
  let str = `type ${interfaceName} = `
  if (schema.additionalProperties && Object.keys(schema.additionalProperties).length) {
    return `${str}${dicType(schema, interfaceName, stack)}`
  }
  if (schema.$ref) {
    const [, defName, keyName] = schema.$ref.match(refRe)
    return `${str}Oa${capFirst(defName)}${capFirst(keyName)}${(schema.nullable && !schema.enum) ? '|null' : ''}`
  }
  if (schema.enum) {
    str += schema.enum
      .map((v: unknown) => v === null ? `${v}` : typeof v === 'number' ? v : `'${v}'`)
      .join(' | ')
  } else {
    str += schema.type ?? 'any'
  }
  if (schema.anyOf) { // validates the value against any (one or more) of the sub-schemas
    const anyOf = []
    for (let i = 0; i < schema.anyOf.length; i++) {
      const propertyInterfaceName = `${interfaceName}Item${i}`
      stack.push([schema.anyOf[i], propertyInterfaceName])
      anyOf.push(propertyInterfaceName)
    }
    str += anyOf.join(' | ')
    str += '// AnyOf'
  }
  if (schema.oneOf) { // validates the value against exactly one of the sub-schemas
    const oneOf = []
    for (let i = 0; i < schema.oneOf.length; i++) {
      const propertyInterfaceName = `${interfaceName}Item${i}`
      stack.push([schema.oneOf[i], propertyInterfaceName])
      oneOf.push(propertyInterfaceName)
    }
    str += ` & OneOf<${oneOf.join('|')}>`
  }
  if (schema.allOf) { // validates the value against all the sub-schemas
    const allOf = []
    for (let i = 0; i < schema.allOf.length; i++) {
      const propertyInterfaceName = `${interfaceName}Item${i}`
      stack.push([schema.allOf[i], propertyInterfaceName])
      allOf.push(propertyInterfaceName)
    }
    str += allOf.join(' & ')
    str += '// AllOf'
  }
  if (schema.not) {
    const propertyInterfaceName = `${interfaceName}Not`
    stack.push([schema.not, propertyInterfaceName])
    str += ` & Exclude<any, ${propertyInterfaceName}>`
  }
  return str
}

function genTypes(schema: Schema, interfaceName: string) {
  const stack: Stack = [[schema, interfaceName]]

  const types = []
  while (stack.length) {
    const [schema, interfaceName] = stack.shift()!
    if (schema.properties) {
      types.push(genInterface(schema, interfaceName, stack))
    } else {
      types.push(genType(schema, interfaceName, stack))
    }
  }

  return types.join('\n')
}

/** Add id, replace timestamps / userstamps / trackedProperties… */
function cleanSchema(schema: Schema, typeName: string) {
  const tStr = { type: 'string' }
  const tDate = { type: 'string', format: 'date' }

  schema.properties = { id: { type: 'string' }, ...schema.properties }
  if (!schema.required) schema.required = []
  schema.required.push('id')

  if (schema.timestamps) {
    const timestamps = schema.timestamps === true ? { createdAt: true, updatedAt: true, deletedAt: true } : (schema.timestamps || {})
    schema.properties = { ...schema.properties, ...Object.keys(timestamps).reduce((o, k) => ({ ...o, [k]: tDate }), {} as Record<string, typeof tDate>) }
    delete schema.timestamps
  }

  if (schema.userstamps) {
    const userstamps = schema.userstamps === true ? { createdBy: true, updatedBy: true, deletedBy: true } : (schema.userstamps || {})
    schema.properties = { ...schema.properties, ...Object.keys(userstamps).reduce((o, k) => ({ ...o, [k]: tStr }), {} as Record<string, typeof tStr>) }
    delete schema.userstamps
  }
  const props = new Set<string>() // props to put in updates
  if (Array.isArray(schema.trackedProperties)) {
    schema.trackedProperties.forEach(props.add, props)
    props.add('updatedAt')
  } else if (schema.trackedProperties === true) { // track all
    for (const key in schema.properties) {
      if (!['id', 'createdAt', 'createdBy'].includes(key) && !schema.properties[key].readOnly) { // except readOnly properties & id & createdAt/By
        props.add(key)
      }
    }
    props.add('updatedAt')
  }
  const trackedProps = [...props].map(prop => `'${prop}'`).join(' | ')
  if (trackedProps) {
    schema.properties.updatedAt = tDate
    schema.properties.updates = {
      description: 'Keeps track of some updated properties',
      type: `Pick<${typeName}, ${trackedProps}>[]`
    }
    delete schema.trackedProperties
  }
  delete schema.encryptedProperties

  return schema
}

function typeGenerator(schemasByName: Record<string, Schema>, defsSchemas: DefsSchema[] = [], clientSchemaByName: Record<string, Schema> = {}): string {
  const allTypes = ['']
  const modelNames = Object.keys(schemasByName)

  for (const modelName of modelNames) {
    const typeName = `Oa${modelName}`
    const schema = cleanSchema(JSON.parse(JSON.stringify(schemasByName[modelName])), typeName)
    allTypes.push(genTypes(schema, typeName))
  }

  for (const defsSchema of defsSchemas) {
    const { $id, definitions } = defsSchema
    const name = capFirst($id.split('/').pop() as string)
    for (const key in definitions) {
      allTypes.push(genTypes(definitions[key], `Oa${name}${capFirst(key)}`))
    }
  }

  return [
    '// Generated by nuxt-oa',
    genericTypeHelpers,
    allTypes.join('\n\n'),
    // Define models (client) schemas
    ...Object.entries(clientSchemaByName).map(([model, v]) => `type Oa${model}ClientSchema = ${JSON.stringify(v)}`),
    // Associate all models to their types
    '\ndeclare module "nuxt-oa" {',
    '  interface OaModels {',
    ...modelNames.flatMap(name => `    ${name}: Oa${name}`),
    '  }',
    '  interface OaClientSchemas {',
    ...modelNames.flatMap(name => `    ${name}: Oa${name}ClientSchema`),
    '  }',
    '}'
  ].join('\n')
}

export default function typeGeneratorCatchError(schemasByName: Record<string, Schema>, defsSchemas: DefsSchema[] = [], clientSchemaByName: Record<string, Schema> = {}): string {
  try {
    return typeGenerator(schemasByName, defsSchemas, clientSchemaByName)
  } catch (error) {
    consola.error(error)
    return '/* An error occurred */'
  }
}
