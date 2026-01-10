import { createRootRoute, Outlet, HeadContent, Scripts } from '@tanstack/react-router'
import { RootProvider } from 'fumadocs-ui/provider/tanstack'
import React, { useEffect } from 'react'
import { ThemeScript, useThemeStore } from '@mdxui/themes'

export const Route = createRootRoute({
  component: RootComponent,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
    ],
  }),
})

function ThemeInitializer() {
  const { initialize, applyTheme } = useThemeStore()

  useEffect(() => {
    initialize()
    applyTheme()
  }, [initialize, applyTheme])

  return null
}

function RootComponent() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <ThemeScript defaultMode="system" />
      </head>
      <body>
        <ThemeInitializer />
        <RootProvider>
          <Outlet />
        </RootProvider>
        <Scripts />
      </body>
    </html>
  )
}
