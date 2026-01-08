import { RootProvider } from 'fumadocs-ui/provider/tanstack'
import { Outlet, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootProvider>
      <Outlet />
    </RootProvider>
  )
}
