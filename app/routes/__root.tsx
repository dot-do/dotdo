import { Outlet, createRootRoute } from '@tanstack/react-router'
import { Layout } from '../components/Layout'
import '../app.css'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>dotdo - Business-as-Code Platform</title>
        <meta name="description" content="dotdo: Business-as-Code. Services-as-Software." />
      </head>
      <body>
        <Layout>
          <Outlet />
        </Layout>
      </body>
    </html>
  )
}
