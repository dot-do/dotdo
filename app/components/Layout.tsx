import { ReactNode } from 'react'
import { Nav, NavLink } from './Nav'

export interface LayoutProps {
  children: ReactNode
  title?: string
  description?: string
  navLinks?: NavLink[]
  showHeader?: boolean
  showFooter?: boolean
  className?: string
}

export function Layout({
  children,
  title = 'dotdo',
  description = 'Business-as-Code. Services-as-Software.',
  navLinks,
  showHeader = true,
  showFooter = true,
  className = '',
}: LayoutProps) {
  return (
    <div className={`min-h-screen flex flex-col ${className}`}>
      {showHeader && (
        <header className="bg-primary-600 text-white shadow-lg">
          <div className="container py-4">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold">{title}</h1>
              <Nav links={navLinks} />
            </div>
            {description && (
              <p className="text-sm text-gray-100 mt-2">{description}</p>
            )}
          </div>
        </header>
      )}
      <main className={`flex-1 ${showHeader ? '' : 'pt-0'}`}>{children}</main>
      {showFooter && (
        <footer className="bg-gray-100 border-t border-gray-200">
          <div className="container py-4 text-center text-sm text-gray-600">
            &copy; {new Date().getFullYear()} dotdo. All rights reserved.
          </div>
        </footer>
      )}
    </div>
  )
}

export interface PageLayoutProps {
  children: ReactNode
  title?: string
  subtitle?: string
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | 'full'
  className?: string
}

const maxWidthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
  full: 'max-w-full',
}

export function PageLayout({
  children,
  title,
  subtitle,
  maxWidth = '4xl',
  className = '',
}: PageLayoutProps) {
  return (
    <div className="container py-12">
      <div className={`mx-auto ${maxWidthClasses[maxWidth]} ${className}`}>
        {title && (
          <h1 className="text-5xl font-bold mb-6 text-gray-900">{title}</h1>
        )}
        {subtitle && (
          <p className="text-xl text-gray-600 mb-8">{subtitle}</p>
        )}
        {children}
      </div>
    </div>
  )
}
