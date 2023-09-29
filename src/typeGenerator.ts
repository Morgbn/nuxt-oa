import { Schema, DefsSchema } from './runtime/types'

type Stack = [Schema, string][]

const genericTypeHelpers = `
type _AllKeys<T> = T extends unknown ? keyof T : never
type _Id<T> = T extends infer U ? { [K in keyof U]: U[K] } : never
type _ExclusiveUnion<T, K extends PropertyKey> =
    T extends unknown ? _Id<T & Partial<Record<Exclude<K, keyof T>, never>>> : never
type OneOf<T> = _ExclusiveUnion<T, _AllKeys<T>>`

const capFirst = (str: string) => str[0].toUpperCase() + str.slice(1)

const refRe = /(\w+)(?:\.\w+)?#(?:\/(\w+))+/
function simplestType (schema: Schema, interfaceName: string, stack: Stack): string {
  const suffix = (schema.nullable && !schema.enum) ? '|null' : '' // null must be explicitly included in the list of enum values, see: https://github.com/OAI/OpenAPI-Specification/blob/main/proposals/2019-10-31-Clarify-Nullable.md#if-a-schema-specifies-nullable-true-and-enum-1-2-3-does-that-schema-allow-null-values-see-1900
  if (schema.$ref) {
    const [, defName, keyName] = schema.$ref.match(refRe)
    return `Oa${capFirst(defName)}${capFirst(keyName)}${suffix}`
  }
  if (schema.properties || schema.enum || schema.anyOf || schema.oneOf || schema.allOf || schema.not) {
    stack.push([schema, interfaceName])
    return `${interfaceName}${suffix}`
  }
  if (schema.format === 'date' || schema.format === 'date-time') {
    return `${schema.type ?? 'string'}|Date${suffix}`
  }
  return `${schema.type ?? 'any'}${suffix}`
}

function genInterface (schema: Schema, interfaceName: string, stack: Stack): string {
  let str = `\ninterface ${interfaceName} {\n`

  for (const propName in schema.properties) {
    const propSchema = schema.properties[propName]
    if (propSchema.description) {
      str += `  /**${['', ...propSchema.description.trim().split('\n')].join('\n   * ')}\n   */\n`
    }
    str += `  ${propSchema.readOnly ? 'readonly ' : ''}${propName}${schema.required && schema.required.includes(propName) ? '' : '?'}: `

    const propInterfaceName = `${interfaceName}${capFirst(propName)}`
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
    } else {
      str += simplestType(propSchema, propInterfaceName, stack)
    }
    str += '\n'
  }
  return str + '}\n'
}

function genType (schema: Schema, interfaceName: string, stack: Stack) {
  let str = `type ${interfaceName} = `
  if (schema.enum) {
    str += schema.enum
      .map((v: any) => v === null ? `${v}` : typeof v === 'number' ? v : `'${v}'`)
      .join(' | ')
  } else {
    str += schema.type ?? 'any'
  }
  if (schema.anyOf) {
    const anyOf = []
    for (let i = 0; i < schema.anyOf.length; i++) {
      const propertyInterfaceName = `${interfaceName}Item${i}`
      stack.push([schema.anyOf[i], propertyInterfaceName])
      anyOf.push(propertyInterfaceName)
    }
    str += anyOf.join(' | ')
    str += '// AnyOf'
  }
  if (schema.oneOf) {
    const oneOf = []
    for (let i = 0; i < schema.oneOf.length; i++) {
      const propertyInterfaceName = `${interfaceName}Item${i}`
      stack.push([schema.oneOf[i], propertyInterfaceName])
      oneOf.push(propertyInterfaceName)
    }
    str += ` & OneOf<${oneOf.join('|')}>`
  }
  if (schema.allOf) {
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

function genTypes (schema: Schema, interfaceName: string) {
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

export default function typeGenerator (schemasByName: Schema, defsSchemas: DefsSchema[] = []): string {
  const allTypes = ['// Generated by nuxt-oa', genericTypeHelpers]
  const tStr = { type: 'string' }
  const tDate = { format: 'date' }
  const modelNames = Object.keys(schemasByName)

  for (const modelName of modelNames) {
    const typeName = `Oa${modelName}`
    const schema = schemasByName[modelName]

    schema.properties = { id: { type: 'string' }, ...schema.properties }
    if (!schema.required) { schema.required = [] }
    schema.required.push('id')

    if (schema.timestamps) {
      const timestamps = typeof schema.timestamps === 'object'
        ? schema.timestamps
        : (!schema.timestamps ? {} : { createdAt: tDate, updatedAt: tDate, deletedAt: tDate })
      schema.properties = { ...schema.properties, ...timestamps }
      delete schema.timestamps
    }

    if (schema.userstamps) {
      const userstamps = typeof schema.userstamps === 'object'
        ? schema.userstamps
        : (!schema.userstamps ? {} : { createdBy: tStr, updatedBy: tStr, deletedBy: tStr })
      schema.properties = { ...schema.properties, ...userstamps }
      delete schema.userstamps
    }
    const trackedProps = schema.trackedProperties?.map((prop: string) => `'${prop}'`).join(' | ')
    if (trackedProps) {
      schema.properties.updatedAt = tDate
      schema.properties.updates = {
        description: 'Keeps track of some updated properties',
        type: `Pick<${typeName}, ${trackedProps} | 'updatedAt'>[]`
      }
      delete schema.trackedProperties
    }
    delete schema.encryptedProperties

    allTypes.push(genTypes(schema, typeName))
  }

  for (const defsSchema of defsSchemas) {
    const { $id, definitions } = defsSchema
    const name = capFirst($id.split('/').pop() as string)
    for (const key in definitions) {
      allTypes.push(genTypes(definitions[key], `Oa${name}${capFirst(key)}`))
    }
  }
  allTypes.push([
    'declare module "nuxt-oa" {',
    '  interface OaModels {',
    ...modelNames.flatMap(name => `    ${name}: Oa${name}`),
    '  }',
    '}'
  ].join('\n'))
  return allTypes.join('\n\n')
}
