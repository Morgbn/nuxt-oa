import { createRouter, eventHandler, useBase } from 'h3'
import type { CreateRouterOptions, EventHandler } from 'h3'

const methods = ['get', 'head', 'patch', 'post', 'put', 'delete', 'connect', 'options', 'trace'] as const
type Method = typeof methods[number]

export interface OaFunction extends EventHandler {
  __apiDoc?: object|Function
}

export function oaHandler (func: OaFunction, schema: object|Function = {}): OaFunction {
  func.__apiDoc = schema
  return func
}

type AtLeastOne<T> = [T, ...T[]]

type OaRouterFunc<T> = (path: string, ...middlewares: AtLeastOne<OaFunction>) => T

export interface OaRouter extends EventHandler {
  get: OaRouterFunc<OaRouter>
  head: OaRouterFunc<OaRouter>
  patch: OaRouterFunc<OaRouter>
  post: OaRouterFunc<OaRouter>
  put: OaRouterFunc<OaRouter>
  delete: OaRouterFunc<OaRouter>
  connect: OaRouterFunc<OaRouter>
  options: OaRouterFunc<OaRouter>
  trace: OaRouterFunc<OaRouter>
}

export const paths: Record<string, {[key in Method]?: object}> = {}

const upsertPath = (p: string): {[key in Method]?: object} =>
  paths[p] ? paths[p] : (paths[p] = {})

const pathParamRe = /\/\*|\/:(\w+)/g // regex to transform radix3 placeholder (:slug) into openapi path parameter ({slug})
const oaPathParam = '/{$1}'

export function createOaRouter (basePath: string, opts: CreateRouterOptions = {}): OaRouter {
  const router = createRouter(opts)
  const oaRouter = useBase(basePath, router.handler) as OaRouter
  for (const method of methods) {
    oaRouter[method] = (path: string, ...stack: AtLeastOne<OaFunction>) => { // accept middleware per route
      const doc = upsertPath(`${basePath}${path}`.replace(pathParamRe, oaPathParam))
      const docFuncs: Function[] = []
      for (const func of stack) {
        const apiDDoc = func.__apiDoc
        if (apiDDoc) {
          if (typeof apiDDoc === 'function') {
            docFuncs.push(apiDDoc)
          } else {
            doc[method] = { ...doc[method], ...apiDDoc }
          }
        }
      }
      for (const func of docFuncs) {
        func(doc[method])
      }
      const lastFunc = stack.pop() || (async () => {})
      router.add(path, eventHandler(async (event) => {
        for (const middleware of stack) { await middleware(event) }
        return await lastFunc(event)
      }), method)
      return oaRouter
    }
  }
  return oaRouter
}

export const components: Record<string, object> = {}
export function oaComponent (name: string, schema: object) {
  components[name] = schema
}
