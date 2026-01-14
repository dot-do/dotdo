/**
 * Admin Settings Index Route
 *
 * Settings overview with links to various setting sections.
 * Features:
 * - Visual icons for each settings category
 * - Clear navigation with descriptive cards
 * - Keyboard navigation support
 * - Accessible focus states
 */

import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, useCallback, useRef, useEffect, KeyboardEvent } from 'react'
import { Shell } from '~/components/ui/shell'

export const Route = createFileRoute('/admin/settings/')({
  component: SettingsIndexPage,
})

// =============================================================================
// Icons
// =============================================================================

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    </svg>
  )
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
    </svg>
  )
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
    </svg>
  )
}

function PaletteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 0 0 5.304 0l6.401-6.402M6.75 21A3.75 3.75 0 0 1 3 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 0 0 3.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008Z" />
    </svg>
  )
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
    </svg>
  )
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  )
}

// =============================================================================
// Settings Card Component
// =============================================================================

interface SettingsCardProps {
  href: string
  icon: React.ReactNode
  title: string
  description: string
  testId: string
  disabled?: boolean
  badge?: string
  tabIndex?: number
  onKeyDown?: (e: KeyboardEvent<HTMLAnchorElement | HTMLDivElement>) => void
  cardRef?: React.RefObject<HTMLAnchorElement | null>
}

function SettingsCard({ href, icon, title, description, testId, disabled, badge, tabIndex = 0, onKeyDown, cardRef }: SettingsCardProps) {
  const content = (
    <>
      <div className="flex items-start gap-4">
        <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${disabled ? 'bg-muted' : 'bg-primary/10'}`}>
          <span className={disabled ? 'text-muted-foreground' : 'text-primary'}>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className={`text-lg font-semibold ${disabled ? 'text-muted-foreground' : ''}`}>{title}</h3>
            {badge && (
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-muted text-muted-foreground">
                {badge}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        {!disabled && (
          <ChevronRightIcon className="w-5 h-5 text-muted-foreground flex-shrink-0 transition-transform group-hover:translate-x-1" />
        )}
      </div>
    </>
  )

  if (disabled) {
    return (
      <div
        className="bg-card rounded-lg shadow p-6 opacity-60 cursor-not-allowed"
        data-testid={testId}
        aria-disabled="true"
        tabIndex={-1}
      >
        {content}
      </div>
    )
  }

  return (
    <Link
      ref={cardRef}
      to={href}
      className="group bg-card rounded-lg shadow p-6 hover:shadow-lg hover:border-primary/20 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
      data-testid={testId}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
    >
      {content}
    </Link>
  )
}

// =============================================================================
// Settings Items Configuration
// =============================================================================

interface SettingsItem {
  id: string
  href: string
  icon: React.ReactNode
  title: string
  description: string
  testId: string
  disabled?: boolean
  badge?: string
}

const settingsItems: SettingsItem[] = [
  {
    id: 'account',
    href: '/admin/settings/account',
    icon: <UserIcon className="w-5 h-5" />,
    title: 'Account & Profile',
    description: 'Update your name, email, and profile photo.',
    testId: 'settings-tab-account',
  },
  {
    id: 'security',
    href: '/admin/settings/security',
    icon: <ShieldIcon className="w-5 h-5" />,
    title: 'Security & Password',
    description: 'Manage password, 2FA, and active sessions.',
    testId: 'settings-tab-security',
  },
  {
    id: 'notifications',
    href: '/admin/settings/notifications',
    icon: <BellIcon className="w-5 h-5" />,
    title: 'Notifications',
    description: 'Configure email alerts and push notifications.',
    testId: 'settings-tab-notifications',
    disabled: true,
    badge: 'Coming Soon',
  },
  {
    id: 'appearance',
    href: '/admin/settings/appearance',
    icon: <PaletteIcon className="w-5 h-5" />,
    title: 'Appearance & Theme',
    description: 'Customize colors, dark mode, and visual preferences.',
    testId: 'settings-tab-appearance',
  },
  {
    id: 'api-keys',
    href: '/admin/integrations/api-keys',
    icon: <KeyIcon className="w-5 h-5" />,
    title: 'API Keys',
    description: 'Generate and manage API keys for integrations.',
    testId: 'settings-tab-api-keys',
  },
]

// =============================================================================
// Component
// =============================================================================

function SettingsIndexPage() {
  const navigate = useNavigate()
  const [focusedIndex, setFocusedIndex] = useState(0)
  const cardRefs = useRef<(HTMLAnchorElement | null)[]>([])

  // Filter to only enabled items for navigation
  const enabledItems = settingsItems.filter((item) => !item.disabled)
  const enabledIndices = settingsItems.map((item, i) => (!item.disabled ? i : -1)).filter((i) => i !== -1)

  // Get the enabled item index from global index
  const getEnabledIndex = useCallback((globalIndex: number) => {
    return enabledIndices.indexOf(globalIndex)
  }, [enabledIndices])

  // Get the global index from enabled index
  const getGlobalIndex = useCallback((enabledIndex: number) => {
    return enabledIndices[enabledIndex] ?? 0
  }, [enabledIndices])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLAnchorElement | HTMLDivElement>, globalIndex: number) => {
    const enabledIndex = getEnabledIndex(globalIndex)
    if (enabledIndex === -1) return

    let newEnabledIndex = enabledIndex

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        newEnabledIndex = (enabledIndex + 1) % enabledItems.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        newEnabledIndex = (enabledIndex - 1 + enabledItems.length) % enabledItems.length
        break
      case 'Home':
        e.preventDefault()
        newEnabledIndex = 0
        break
      case 'End':
        e.preventDefault()
        newEnabledIndex = enabledItems.length - 1
        break
      default:
        return
    }

    const newGlobalIndex = getGlobalIndex(newEnabledIndex)
    setFocusedIndex(newGlobalIndex)
    cardRefs.current[newGlobalIndex]?.focus()
  }, [enabledItems.length, getEnabledIndex, getGlobalIndex])

  // Handle card focus
  const handleFocus = useCallback((globalIndex: number) => {
    setFocusedIndex(globalIndex)
  }, [])

  // Set up keyboard shortcuts for quick navigation
  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      // Number keys 1-5 for quick navigation
      const num = parseInt(e.key)
      if (num >= 1 && num <= enabledItems.length && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement
        // Only trigger if not in an input/textarea
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return
        }
        e.preventDefault()
        const globalIndex = getGlobalIndex(num - 1)
        setFocusedIndex(globalIndex)
        cardRefs.current[globalIndex]?.focus()
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [enabledItems.length, getGlobalIndex])

  return (
    <Shell>
      <div className="p-6" data-testid="settings-layout">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-muted-foreground mt-1">
            Manage your account, security, and application preferences.
          </p>
        </div>

        <nav
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          data-testid="settings-nav"
          aria-label="Settings navigation"
          role="list"
        >
          {settingsItems.map((item, index) => (
            <SettingsCard
              key={item.id}
              href={item.href}
              icon={item.icon}
              title={item.title}
              description={item.description}
              testId={item.testId}
              disabled={item.disabled}
              badge={item.badge}
              tabIndex={item.disabled ? -1 : focusedIndex === index ? 0 : -1}
              onKeyDown={(e) => handleKeyDown(e, index)}
              cardRef={(el) => {
                cardRefs.current[index] = el
              } as unknown as React.RefObject<HTMLAnchorElement | null>}
            />
          ))}
        </nav>

        {/* Keyboard Shortcuts Help */}
        <div className="mt-8 p-4 rounded-lg bg-muted/50 max-w-2xl">
          <h2 className="text-sm font-medium mb-2">Keyboard Shortcuts</h2>
          <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">Arrow Keys</kbd>
              <span>Navigate between sections</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">Enter</kbd>
              <span>Open selected section</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">1-5</kbd>
              <span>Quick jump to section</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">Home/End</kbd>
              <span>Jump to first/last section</span>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  )
}
