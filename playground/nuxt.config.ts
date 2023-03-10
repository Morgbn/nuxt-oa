import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  modules: ['../src/module'],
  oa: {
    dbUrl: process.env.DB_URL,
    cipherKey: process.env.PII_ENCRYPT_KEY,
    openApiGeneralInfo: {
      title: 'Nuxt-OA Playground API',
      description: 'Swagger Page for the Playground API of nxut-oa module.',
      version: '1.0.0'
    }
  }
})
