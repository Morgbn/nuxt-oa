import type { KeywordDefinition } from 'ajv'

export const keywords: KeywordDefinition[] = [{
  keyword: 'range', // example from https://ajv.js.org/keywords.html#define-keyword-with-validate-function
  validate([min, max], data, parentSchema, _dataCxt) {
    return data >= min && data <= max
  },
  error: {
    message: ({ schema: [min, max], parentSchema }) => {
      return `Value must be between ${min} and ${max} (inclusive)`
    }
  },
  metaSchema: {
    // schema to validate keyword value
    type: 'array',
    items: [{ type: 'number' }, { type: 'number' }],
    minItems: 2,
    additionalItems: false
  }
}]
