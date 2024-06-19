import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

export default createConfigForNuxt({
  features: {
    tooling: true
  }
})
  .append({
    rules: {
      "@typescript-eslint/no-unused-vars": 'off'
    }
  })
