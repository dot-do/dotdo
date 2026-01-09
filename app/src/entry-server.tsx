import { renderToString } from 'react-dom/server'
import { StartServer, createStartHandler } from '@tanstack/react-start/server'
import { createRouter } from './router'

export default createStartHandler({
  createRouter,
  getRouterManifest: () => import('./routeTree.gen').then((m) => m.routeTree),
})(({ router }) => (
  <StartServer router={router} />
))
