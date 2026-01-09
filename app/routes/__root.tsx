import { createRootRoute, Outlet } from '@tanstack/react-router'
import { RootProvider } from 'fumadocs-ui/provider/tanstack'
import React from 'react'

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
