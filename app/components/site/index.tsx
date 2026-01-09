/**
 * Site MDX Components
 *
 * Components used in Site.mdx for the landing page.
 * These map to the MDXUI Beacon patterns.
 */

import type { ReactNode } from 'react'

// Agent Grid
interface AgentGridProps {
  children: ReactNode
}

export function AgentGrid({ children }: AgentGridProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 my-8">{children}</div>
  )
}

interface AgentProps {
  name: string
  role: string
  avatar?: string
  children?: ReactNode
}

export function Agent({ name, role, avatar, children }: AgentProps) {
  return (
    <div className="text-center p-4 bg-gray-900 rounded-lg border border-gray-800">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xl font-bold">
        {avatar || name[0]}
      </div>
      <h3 className="font-semibold">{name}</h3>
      <p className="text-xs text-gray-500">{role}</p>
      {children && <p className="text-xs text-gray-400 mt-1">{children}</p>}
    </div>
  )
}

// Feature Grid
interface FeatureGridProps {
  children: ReactNode
}

export function FeatureGrid({ children }: FeatureGridProps) {
  return <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 my-8">{children}</div>
}

interface FeatureProps {
  icon: string
  title: string
  children: ReactNode
}

export function Feature({ icon, title, children }: FeatureProps) {
  return (
    <div className="p-6 bg-gray-900 rounded-lg border border-gray-800">
      <div className="text-3xl mb-4">{icon}</div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-gray-400">{children}</p>
    </div>
  )
}

// CTA
interface CTAProps {
  primary: string
  secondary?: string
  children: ReactNode
}

export function CTA({ primary, secondary, children }: CTAProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-4 justify-center my-8">
      <a
        href={primary}
        className="px-8 py-4 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition text-center"
      >
        {children}
      </a>
      {secondary && (
        <a
          href={secondary}
          className="px-8 py-4 border border-gray-700 font-semibold rounded-lg hover:border-gray-500 transition text-center"
        >
          View on GitHub
        </a>
      )}
    </div>
  )
}

// Hero section wrapper
interface HeroProps {
  children: ReactNode
}

export function Hero({ children }: HeroProps) {
  return (
    <section className="py-20 px-4">
      <div className="container max-w-6xl mx-auto text-center">{children}</div>
    </section>
  )
}

// Section wrapper
interface SectionProps {
  children: ReactNode
  background?: 'default' | 'alt'
}

export function Section({ children, background = 'default' }: SectionProps) {
  const bg = background === 'alt' ? 'bg-gray-900/50' : ''
  return (
    <section className={`py-20 px-4 border-t border-gray-800 ${bg}`}>
      <div className="container max-w-6xl mx-auto">{children}</div>
    </section>
  )
}

// Code block with terminal styling
interface CodeBlockProps {
  filename?: string
  children: ReactNode
}

export function CodeBlock({ filename, children }: CodeBlockProps) {
  return (
    <div className="max-w-3xl mx-auto my-8">
      <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
        {filename && (
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="ml-2 text-sm text-gray-500">{filename}</span>
          </div>
        )}
        <div className="p-4 overflow-x-auto">{children}</div>
      </div>
    </div>
  )
}

// Export all components
export { LandingLayout } from './LandingLayout'
