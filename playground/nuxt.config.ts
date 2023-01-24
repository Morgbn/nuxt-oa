import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  modules: ['../src/module'],
  oa: {
    dbUrl: process.env.DB_URL
  }
})
