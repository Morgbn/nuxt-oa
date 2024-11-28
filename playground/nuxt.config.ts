import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  extends: [
    './base'
  ],
  modules: ['../src/module'],
  runtimeConfig: {
    oa: {
      dbUrl: '',
      cipherKey: ''
    }
  },
  oa: {
    openApiGeneralInfo: {
      title: 'Nuxt-OA Playground API',
      description: 'Swagger Page for the Playground API of nxut-oa module.',
      version: '1.0.0'
    }
  }
})
