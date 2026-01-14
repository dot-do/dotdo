import config from '@payload-config'
import { RootLayout, handleServerFunctions } from '@payloadcms/next/layouts'
import type { ServerFunctionClient } from 'payload'
import '@payloadcms/next/css'

const serverFunction: ServerFunctionClient = async ({ args, name }) => {
  'use server'
  return handleServerFunctions({ args, name, config, importMap: {} })
}

export default async function Layout({ children }: { children: React.ReactNode }) {
  return (
    <RootLayout config={config} importMap={{}} serverFunction={serverFunction}>
      {children}
    </RootLayout>
  )
}
