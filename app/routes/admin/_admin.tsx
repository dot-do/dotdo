'use client'

/**
 * Admin Layout Route
 *
 * Layout route that wraps all admin routes with AuthProvider and
 * provides the admin shell UI with sidebar navigation.
 *
 * ## Protected Routes
 * All admin routes are protected by default except:
 * - /admin/login
 * - /admin/signup
 * - /admin/reset-password
 *
 * ## Authentication Flow
 * 1. Check if route is public (login, signup, reset-password)
 * 2. If public, render without auth check
 * 3. If protected, check isAuthenticated
 * 4. If loading, show loading state
 * 5. If not authenticated, redirect to /admin/login
 * 6. If authenticated, render protected content with shell
 *
 * ## Shell Structure (data-testid)
 * - admin-shell: Root container
 * - admin-sidebar: Desktop sidebar
 * - admin-sidebar-header: Logo/branding area
 * - admin-sidebar-nav: Navigation items
 * - admin-sidebar-footer: User menu area
 * - admin-main: Main content area
 * - admin-mobile-trigger: Mobile menu button
 * - admin-mobile-drawer: Mobile navigation drawer
 */

import { type ReactNode, useState, useCallback, createContext, useContext, useEffect } from 'react'
import { createFileRoute, Outlet, Navigate, useLocation, Link as RouterLink } from '@tanstack/react-router'
import { AuthProvider, useAuth } from '~/src/admin/auth'
import { useTheme } from 'next-themes'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@mdxui/primitives/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mdxui/primitives/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@mdxui/primitives/avatar'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@mdxui/primitives/sheet'
import { Button } from '@mdxui/primitives/button'
import {
  BarChart3,
  Settings,
  Activity,
  Key,
  Users,
  CreditCard,
  LogOut,
  Moon,
  Sun,
  Menu,
  X,
  ChevronsUpDown,
  PanelLeftClose,
  PanelLeft,
  LayoutGrid,
} from 'lucide-react'

export const Route = createFileRoute('/admin/_admin')({
  component: AdminLayout,
})

// =============================================================================
// Constants
// =============================================================================

/**
 * Public routes that don't require authentication
 * Note: These paths match the actual URL paths, not the file-based route paths
 */
const publicRoutes = ['/admin/login', '/admin/signup', '/admin/reset-password']

/**
 * Navigation items for the admin sidebar
 */
const navItems = [
  { id: 'overview', title: 'Overview', url: '/admin', icon: BarChart3 },
  { id: 'settings', title: 'Settings', url: '/admin/settings', icon: Settings },
  { id: 'requests', title: 'Requests', url: '/admin/activity', icon: Activity },
  { id: 'api-keys', title: 'API Keys', url: '/admin/integrations/api-keys', icon: Key },
  { id: 'team', title: 'Team', url: '/admin/users', icon: Users },
  { id: 'billing', title: 'Billing', url: '/admin/billing', icon: CreditCard },
]

// =============================================================================
// Mobile Drawer Context
// =============================================================================

interface MobileDrawerContextValue {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

const MobileDrawerContext = createContext<MobileDrawerContextValue | null>(null)

function useMobileDrawer() {
  const context = useContext(MobileDrawerContext)
  if (!context) {
    throw new Error('useMobileDrawer must be used within MobileDrawerProvider')
  }
  return context
}

function MobileDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((prev) => !prev), [])

  return (
    <MobileDrawerContext.Provider value={{ isOpen, open, close, toggle }}>
      {children}
    </MobileDrawerContext.Provider>
  )
}

// =============================================================================
// Helper Components
// =============================================================================

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

// =============================================================================
// Logo Component
// =============================================================================

function Logo() {
  return (
    <RouterLink to="/admin" data-testid="admin-logo" className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
        <span className="text-white font-bold text-sm">.do</span>
      </div>
      <span data-testid="admin-brand-name" className="font-semibold text-sidebar-foreground group-data-[collapsible=icon]:hidden">
        dotdo
      </span>
    </RouterLink>
  )
}

// =============================================================================
// Navigation Component
// =============================================================================

interface AdminNavProps {
  onNavigate?: () => void
}

function AdminNav({ onNavigate }: AdminNavProps) {
  const location = useLocation()

  const isActive = (url: string) => {
    if (url === '/admin') {
      return location.pathname === '/admin' || location.pathname === '/admin/'
    }
    return location.pathname.startsWith(url)
  }

  return (
    <nav aria-label="Admin navigation" role="navigation">
      <SidebarMenu>
        {navItems.map((item) => {
          const active = isActive(item.url)
          return (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton
                asChild
                isActive={active}
                tooltip={item.title}
                data-testid={`admin-nav-item-${item.id}`}
                data-active={active}
                aria-current={active ? 'page' : undefined}
              >
                <RouterLink to={item.url} onClick={onNavigate}>
                  <item.icon className="size-4" />
                  <span>{item.title}</span>
                </RouterLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </nav>
  )
}

// =============================================================================
// User Menu Component
// =============================================================================

function UserMenu() {
  const { user, logout } = useAuth()
  const { resolvedTheme, setTheme } = useTheme()
  const { isMobile } = useSidebar()
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)

  const userName = user?.name || user?.email || 'User'
  const userEmail = user?.email || 'user@dotdo.dev'
  const userAvatar = user?.avatar

  const handleThemeToggle = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  const handleSignOut = async () => {
    setIsDropdownOpen(false)
    await logout()
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              data-testid="admin-user-menu"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg" data-testid="admin-user-avatar">
                <AvatarImage src={userAvatar} alt={userName} />
                <AvatarFallback className="rounded-lg">{getInitials(userName)}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-medium">{userName}</span>
                <span className="truncate text-xs text-sidebar-foreground/70">{userEmail}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            data-testid="admin-user-dropdown"
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={userAvatar} alt={userName} />
                  <AvatarFallback className="rounded-lg">{getInitials(userName)}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span data-testid="admin-user-name" className="truncate font-medium">
                    {userName}
                  </span>
                  <span data-testid="admin-user-email" className="truncate text-xs">
                    {userEmail}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="admin-theme-toggle"
              onClick={handleThemeToggle}
              aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
              {resolvedTheme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid="admin-logout-button" onClick={handleSignOut}>
              <LogOut className="size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

// =============================================================================
// Mobile Header Component
// =============================================================================

function MobileHeader() {
  const { open } = useMobileDrawer()

  return (
    <header data-testid="admin-mobile-header" className="flex items-center gap-2 p-4 border-b md:hidden">
      <Button
        variant="ghost"
        size="icon"
        data-testid="admin-mobile-trigger"
        onClick={open}
        aria-label="Open navigation menu"
      >
        <Menu className="size-5" />
      </Button>
      <Logo />
    </header>
  )
}

// =============================================================================
// Mobile Drawer Component
// =============================================================================

function MobileDrawer() {
  const { isOpen, close } = useMobileDrawer()
  const location = useLocation()

  // Close drawer on navigation
  useEffect(() => {
    close()
  }, [location.pathname, close])

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="left"
        data-testid="admin-mobile-drawer"
        className="w-[280px] p-0"
        onInteractOutside={close}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation Menu</SheetTitle>
          <SheetDescription>Navigate through admin pages</SheetDescription>
        </SheetHeader>
        <div className="flex h-full flex-col">
          {/* Drawer Header */}
          <div className="flex items-center justify-between p-4 border-b">
            <Logo />
            <Button
              variant="ghost"
              size="icon"
              data-testid="admin-mobile-close"
              onClick={close}
              aria-label="Close navigation menu"
            >
              <X className="size-5" />
            </Button>
          </div>

          {/* Drawer Navigation */}
          <div className="flex-1 overflow-auto p-4" data-testid="admin-sidebar-nav">
            <AdminNav onNavigate={close} />
          </div>

          {/* Drawer Footer */}
          <div className="border-t p-4" data-testid="admin-sidebar-footer">
            <UserMenu />
          </div>
        </div>
      </SheetContent>
      {/* Overlay for clicking outside */}
      {isOpen && (
        <div
          data-testid="admin-mobile-overlay"
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={close}
        />
      )}
    </Sheet>
  )
}

// =============================================================================
// Sidebar Collapse Button
// =============================================================================

function SidebarCollapseButton() {
  const { state, toggleSidebar } = useSidebar()
  const isCollapsed = state === 'collapsed'

  return (
    <Button
      variant="ghost"
      size="icon"
      data-testid="admin-sidebar-collapse"
      onClick={toggleSidebar}
      aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className="size-7"
    >
      {isCollapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
    </Button>
  )
}

// =============================================================================
// Admin Shell Component
// =============================================================================

function AdminShell({ children }: { children: ReactNode }) {
  return (
    <MobileDrawerProvider>
      <div data-testid="admin-shell" data-component="DashboardShell" className="min-h-screen bg-background">
        <SidebarProvider defaultOpen={true}>
          {/* Desktop Sidebar */}
          <Sidebar data-testid="admin-sidebar" collapsible="icon" className="hidden md:flex">
            <SidebarHeader data-testid="admin-sidebar-header" className="flex flex-row items-center justify-between">
              <Logo />
              <SidebarCollapseButton />
            </SidebarHeader>
            <SidebarContent data-testid="admin-sidebar-nav">
              <AdminNav />
            </SidebarContent>
            <SidebarFooter data-testid="admin-sidebar-footer">
              <UserMenu />
            </SidebarFooter>
            <SidebarRail />
          </Sidebar>

          {/* Main Content Area */}
          <SidebarInset>
            {/* Mobile Header */}
            <MobileHeader />

            {/* Desktop Header */}
            <header data-testid="admin-header" className="hidden md:flex items-center justify-between gap-2 p-4 border-b">
              <SidebarTrigger className="md:hidden" />
              <div className="flex items-center gap-2 ml-auto">
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  data-testid="global-nav-app"
                  data-nav-link="app"
                >
                  <RouterLink to="/app" data-testid="nav-link-app">
                    <LayoutGrid className="mr-2 h-4 w-4" />
                    App
                  </RouterLink>
                </Button>
              </div>
            </header>

            {/* Main Content */}
            <main data-testid="admin-main" className="flex-1 overflow-auto p-6">
              {children}
            </main>
          </SidebarInset>

          {/* Mobile Drawer */}
          <MobileDrawer />
        </SidebarProvider>
      </div>
    </MobileDrawerProvider>
  )
}

// =============================================================================
// AuthGuard Component
// =============================================================================

/**
 * AuthGuard - Protects routes that require authentication
 *
 * Checks authentication state and either:
 * - Renders children if authenticated
 * - Shows loading state while checking auth
 * - Redirects to login if not authenticated
 */
function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, error } = useAuth()
  const location = useLocation()

  // Check if current route is public
  const isPublicRoute = publicRoutes.some(
    (route) => location.pathname === route || location.pathname.startsWith(route + '/')
  )

  // Public routes are always accessible (no shell)
  if (isPublicRoute) {
    return <>{children}</>
  }

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
      </div>
    )
  }

  // Handle auth error state
  if (error) {
    return (
      <div data-testid="admin-error" className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-destructive mb-2">Authentication Error</h1>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  // Redirect to login if not authenticated
  // Include the current path as a redirect parameter
  if (!isAuthenticated) {
    const redirectParam = encodeURIComponent(location.pathname)
    return <Navigate to="/admin/login" search={{ redirect: redirectParam }} />
  }

  // Render protected content with shell
  return <AdminShell>{children}</AdminShell>
}

// =============================================================================
// AdminLayout Component
// =============================================================================

/**
 * AdminLayout - Admin layout component
 *
 * Wraps all admin routes with AuthProvider and AuthGuard
 */
function AdminLayout() {
  return (
    <AuthProvider>
      <AuthGuard>
        <Outlet />
      </AuthGuard>
    </AuthProvider>
  )
}
