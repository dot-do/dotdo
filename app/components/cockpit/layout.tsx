/**
 * Layout Components
 *
 * Dashboard layout, sidebar, and navigation components.
 */

import type { ReactNode } from 'react'
import {
  Home,
  Rocket,
  Users,
  GitBranch,
  Activity,
  Code,
  BarChart as BarChartIcon,
  Settings,
  type LucideIcon,
} from 'lucide-react'

// Icon mapping for string to component conversion
const iconMap: Record<string, LucideIcon> = {
  Home,
  Rocket,
  Users,
  GitBranch,
  Activity,
  Code,
  BarChart: BarChartIcon,
  Settings,
}

// ============================================================================
// Dashboard Layout
// ============================================================================

interface DashboardLayoutProps {
  children: ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div data-component="DashboardLayout" className="flex min-h-screen">
      {children}
    </div>
  )
}

// ============================================================================
// Sidebar Components
// ============================================================================

interface SidebarProps {
  children: ReactNode
}

export function Sidebar({ children }: SidebarProps) {
  return (
    <aside
      data-component="Sidebar"
      className="w-64 bg-background border-r border flex flex-col"
    >
      {children}
    </aside>
  )
}

interface SidebarNavProps {
  children: ReactNode
}

export function SidebarNav({ children }: SidebarNavProps) {
  return (
    <nav data-component="SidebarNav" className="flex-1 p-4 space-y-1">
      {children}
    </nav>
  )
}

interface NavItemProps {
  href: string
  icon?: string
  children: ReactNode
}

export function NavItem({ href, icon, children }: NavItemProps) {
  const IconComponent = icon ? iconMap[icon] : null

  return (
    <div data-component="NavItem">
      <a
        href={href}
        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted transition"
      >
        {IconComponent && (
          <span data-icon={icon}>
            <IconComponent className="w-5 h-5" />
          </span>
        )}
        <span>{children}</span>
      </a>
    </div>
  )
}

export function SidebarUser() {
  return (
    <div data-component="SidebarUser" className="p-4 border-t border">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm font-bold">
          U
        </div>
        <div>
          <div className="text-sm font-medium">User</div>
          <div className="text-xs text-muted-foreground">user@dotdo.dev</div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Dashboard Content
// ============================================================================

interface DashboardContentProps {
  children: ReactNode
}

export function DashboardContent({ children }: DashboardContentProps) {
  return (
    <main data-component="DashboardContent" className="flex-1 p-8 overflow-auto">
      {children}
    </main>
  )
}
