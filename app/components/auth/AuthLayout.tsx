/**
 * AuthLayout Component
 *
 * Layout wrapper for authentication pages with required data-testid attributes
 * for E2E testing.
 *
 * Test IDs:
 * - auth-layout: Root container
 * - auth-title: Page title
 * - auth-subtitle: Page subtitle/description
 * - auth-logo: Branding/logo element
 */

import * as React from 'react'
import { cn } from '@mdxui/primitives/lib/utils'

interface AuthLayoutProps extends React.ComponentProps<'div'> {
  children: React.ReactNode
  title?: string
  subtitle?: string
  logo?: React.ReactNode
  backgroundImage?: string
  showTestimonial?: boolean
  testimonial?: {
    quote: string
    author: string
    role: string
    avatar?: string
  }
}

export function AuthLayout({
  className,
  children,
  title,
  subtitle,
  logo,
  backgroundImage,
  showTestimonial = false,
  testimonial,
  ...props
}: AuthLayoutProps) {
  return (
    <div
      data-testid="auth-layout"
      className={cn('min-h-screen w-full lg:grid lg:grid-cols-2', className)}
      {...props}
    >
      <div className="flex items-center justify-center py-12">
        <div className="mx-auto w-full max-w-[400px] space-y-8 px-4">
          {logo ? (
            <div data-testid="auth-logo" className="flex justify-center">
              {logo}
            </div>
          ) : (
            <div data-testid="auth-logo" className="flex justify-center">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <span className="text-white font-bold text-lg">.do</span>
              </div>
            </div>
          )}

          {(title || subtitle) && (
            <div className="space-y-2 text-center">
              {title && (
                <h1
                  data-testid="auth-title"
                  className="text-3xl font-bold tracking-tight"
                >
                  {title}
                </h1>
              )}
              {subtitle && (
                <p
                  data-testid="auth-subtitle"
                  className="text-muted-foreground text-sm"
                >
                  {subtitle}
                </p>
              )}
            </div>
          )}

          <div>{children}</div>
        </div>
      </div>

      <div
        className="bg-muted hidden lg:block"
        style={
          backgroundImage
            ? {
                backgroundImage: `url(${backgroundImage})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : undefined
        }
      >
        {showTestimonial && testimonial && !backgroundImage && (
          <div className="flex h-full items-center justify-center p-12">
            <div className="max-w-md space-y-6">
              <blockquote className="space-y-4">
                <p className="text-lg font-medium leading-relaxed">
                  "{testimonial.quote}"
                </p>
                <footer className="flex items-center gap-3">
                  {testimonial.avatar && (
                    <img
                      src={testimonial.avatar}
                      alt={testimonial.author}
                      className="size-10 rounded-full"
                    />
                  )}
                  <div>
                    <div className="font-semibold">{testimonial.author}</div>
                    <div className="text-muted-foreground text-sm">
                      {testimonial.role}
                    </div>
                  </div>
                </footer>
              </blockquote>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export type { AuthLayoutProps }
