import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  modules: ['../src/module'],
  extends: [
    './base'
  ],
  oa: {
    openApiGeneralInfo: {
      title: 'Nuxt-OA Playground API',
      description: 'Swagger Page for the Playground API of nxut-oa module.',
      version: '1.0.0'
    }
  },
  runtimeConfig: {
    oa: {
      dbUrl: process.env.DB_URL,
      cipherKey: process.env.PII_ENCRYPT_KEY
    }
  }
})
