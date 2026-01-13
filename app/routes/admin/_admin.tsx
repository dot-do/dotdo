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
 *
 * ## Performance Optimizations
 * - Uses centralized navigation config from ~/lib/shell/navigation
 * - Route prefetching for critical paths
 * - Memoized components to prevent unnecessary re-renders
 * - Error boundaries for section-level isolation
 */

import {
  type ReactNode,
  useState,
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  memo,
} from 'react'
import { createFileRoute, Outlet, Navigate, useLocation, Link as RouterLink } from '@tanstack/react-router'
import { AuthProvider, useAuth } from '~/src/admin/auth'
import { ToastProvider } from '~/components/ui/toast'
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

// Import centralized navigation configuration
import {
  adminNavItems,
  publicAdminRoutes,
  isNavItemActive,
  getPrefetchRoutes,
} from '~/lib/shell/navigation'

// Import route transition utilities
import {
  RouteProgressBar,
  usePrefetchRoutes,
  useReducedMotion,
} from '~/components/ui/route-transition'

// Import error boundary for section isolation
import { DashboardErrorBoundary } from '~/components/cockpit/dashboard-error-boundary'

export const Route = createFileRoute('/admin/_admin')({
  component: AdminLayout,
})

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

/**
 * Hook to access mobile drawer state and actions.
 * Must be used within MobileDrawerProvider.
 */
function useMobileDrawer(): MobileDrawerContextValue {
  const context = useContext(MobileDrawerContext)
  if (!context) {
    throw new Error('useMobileDrawer must be used within MobileDrawerProvider')
  }
  return context
}

/**
 * Provider for mobile drawer state.
 * Memoizes context value to prevent unnecessary re-renders.
 */
function MobileDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((prev) => !prev), [])

  // Memoize context value to prevent unnecessary re-renders of consumers
  const value = useMemo(
    () => ({ isOpen, open, close, toggle }),
    [isOpen, open, close, toggle]
  )

  return (
    <MobileDrawerContext.Provider value={value}>
      {children}
    </MobileDrawerContext.Provider>
  )
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract initials from a user name for avatar fallback.
 * Handles edge cases like single names or empty strings.
 *
 * @param name - Full name to extract initials from
 * @returns Up to 2 uppercase characters
 */
function getInitials(name: string): string {
  if (!name) return '?'
  return name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?'
}

/**
 * Get routes that should be prefetched on shell mount.
 * Uses centralized config from navigation module.
 */
const prefetchRoutes = getPrefetchRoutes(adminNavItems)

// =============================================================================
// Logo Component
// =============================================================================

/**
 * Brand logo component for the admin shell.
 * Memoized to prevent re-renders when sidebar state changes.
 */
const Logo = memo(function Logo() {
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
})

// =============================================================================
// Navigation Component
// =============================================================================

interface AdminNavProps {
  /** Callback when navigation item is clicked (used for mobile drawer close) */
  onNavigate?: () => void
}

/**
 * Admin navigation menu component.
 * Uses centralized navigation config from ~/lib/shell/navigation.
 * Memoized to prevent re-renders when unrelated state changes.
 */
const AdminNav = memo(function AdminNav({ onNavigate }: AdminNavProps) {
  const location = useLocation()

  return (
    <nav aria-label="Admin navigation" role="navigation">
      <SidebarMenu>
        {adminNavItems.map((item) => {
          const active = isNavItemActive(location.pathname, item.url)
          const Icon = item.icon
          return (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton
                asChild
                isActive={active}
                tooltip={item.title}
                data-testid={item.testId}
                data-active={active}
                aria-current={active ? 'page' : undefined}
              >
                <RouterLink to={item.url} onClick={onNavigate}>
                  <Icon className="size-4" aria-hidden="true" />
                  <span>{item.title}</span>
                  {item.shortcut && (
                    <kbd className="ml-auto text-xs text-muted-foreground hidden group-data-[collapsible=icon]:hidden lg:inline">
                      {item.shortcut}
                    </kbd>
                  )}
                </RouterLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </nav>
  )
})

// =============================================================================
// User Menu Component
// =============================================================================

/**
 * User profile menu with theme toggle and logout.
 * Memoized but uses hooks internally so re-renders when auth state changes.
 */
const UserMenu = memo(function UserMenu() {
  const { user, logout } = useAuth()
  const { resolvedTheme, setTheme } = useTheme()
  const { isMobile } = useSidebar()
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  // Memoize user display values
  const { userName, userEmail, userAvatar, initials } = useMemo(() => ({
    userName: user?.name || user?.email || 'User',
    userEmail: user?.email || 'user@dotdo.dev',
    userAvatar: user?.avatar,
    initials: getInitials(user?.name || user?.email || 'User'),
  }), [user])

  const handleThemeToggle = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }, [resolvedTheme, setTheme])

  const handleSignOut = useCallback(async () => {
    setIsDropdownOpen(false)
    setIsLoggingOut(true)
    try {
      await logout()
    } catch (error) {
      // Error is handled by auth context
      console.error('[AdminShell] Logout failed:', error)
    } finally {
      setIsLoggingOut(false)
    }
  }, [logout])

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
                <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-medium">{userName}</span>
                <span className="truncate text-xs text-sidebar-foreground/70">{userEmail}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" aria-hidden="true" />
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
                  <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
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
              {resolvedTheme === 'dark' ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
              {resolvedTheme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="admin-logout-button"
              onClick={handleSignOut}
              disabled={isLoggingOut}
            >
              <LogOut className="size-4" aria-hidden="true" />
              {isLoggingOut ? 'Logging out...' : 'Log out'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
})

// =============================================================================
// Mobile Header Component
// =============================================================================

/**
 * Mobile header with hamburger menu trigger.
 * Memoized - only re-renders when drawer open handler changes.
 */
const MobileHeader = memo(function MobileHeader() {
  const { open } = useMobileDrawer()

  return (
    <header data-testid="admin-mobile-header" className="flex items-center gap-2 p-4 border-b md:hidden">
      <Button
        variant="ghost"
        size="icon"
        data-testid="admin-mobile-trigger"
        onClick={open}
        aria-label="Open navigation menu"
        aria-haspopup="dialog"
      >
        <Menu className="size-5" aria-hidden="true" />
      </Button>
      <Logo />
    </header>
  )
})

// =============================================================================
// Mobile Drawer Component
// =============================================================================

/**
 * Mobile navigation drawer component.
 * Auto-closes on route change for better UX.
 */
const MobileDrawer = memo(function MobileDrawer() {
  const { isOpen, close } = useMobileDrawer()
  const location = useLocation()

  // Close drawer on navigation
  useEffect(() => {
    if (isOpen) {
      close()
    }
  }, [location.pathname]) // Intentionally not including close to avoid extra calls

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) close()
  }, [close])

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
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
              <X className="size-5" aria-hidden="true" />
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
      {/* Overlay for clicking outside - Sheet handles this, but keeping for explicit control */}
      {isOpen && (
        <div
          data-testid="admin-mobile-overlay"
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}
    </Sheet>
  )
})

// =============================================================================
// Sidebar Collapse Button
// =============================================================================

/**
 * Button to toggle sidebar collapse state.
 * Shows different icon based on current state.
 */
const SidebarCollapseButton = memo(function SidebarCollapseButton() {
  const { state, toggleSidebar } = useSidebar()
  const isCollapsed = state === 'collapsed'

  return (
    <Button
      variant="ghost"
      size="icon"
      data-testid="admin-sidebar-collapse"
      onClick={toggleSidebar}
      aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-expanded={!isCollapsed}
      className="size-7"
    >
      {isCollapsed ? (
        <PanelLeft className="size-4" aria-hidden="true" />
      ) : (
        <PanelLeftClose className="size-4" aria-hidden="true" />
      )}
    </Button>
  )
})

// =============================================================================
// Admin Shell Component
// =============================================================================

/**
 * Main admin shell component providing:
 * - Desktop sidebar navigation
 * - Mobile drawer navigation
 * - Route prefetching for performance
 * - Progress bar for route transitions
 * - Error boundaries for section isolation
 */
function AdminShell({ children }: { children: ReactNode }) {
  // Prefetch critical routes on mount for faster navigation
  usePrefetchRoutes({
    routes: prefetchRoutes,
    staggerDelay: 100,
    enabled: true,
  })

  return (
    <MobileDrawerProvider>
      <div data-testid="admin-shell" data-component="DashboardShell" className="min-h-screen bg-background">
        {/* Global progress bar for route transitions */}
        <RouteProgressBar />

        <SidebarProvider defaultOpen={true}>
          {/* Desktop Sidebar */}
          <Sidebar data-testid="admin-sidebar" collapsible="icon" className="hidden md:flex">
            <SidebarHeader data-testid="admin-sidebar-header" className="flex flex-row items-center justify-between">
              <Logo />
              <SidebarCollapseButton />
            </SidebarHeader>
            <SidebarContent data-testid="admin-sidebar-nav">
              <DashboardErrorBoundary sectionTitle="Navigation" compact>
                <AdminNav />
              </DashboardErrorBoundary>
            </SidebarContent>
            <SidebarFooter data-testid="admin-sidebar-footer">
              <DashboardErrorBoundary sectionTitle="User Menu" compact>
                <UserMenu />
              </DashboardErrorBoundary>
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
                    <LayoutGrid className="mr-2 h-4 w-4" aria-hidden="true" />
                    App
                  </RouterLink>
                </Button>
              </div>
            </header>

            {/* Main Content with error boundary */}
            <main data-testid="admin-main" className="flex-1 overflow-auto p-6">
              <DashboardErrorBoundary sectionTitle="Dashboard Content">
                {children}
              </DashboardErrorBoundary>
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
// Loading State Component
// =============================================================================

/**
 * Shell skeleton that mirrors the admin layout structure.
 * Provides visual continuity during auth loading by showing
 * the sidebar and main content area as skeleton placeholders.
 */
const ShellSkeleton = memo(function ShellSkeleton() {
  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar skeleton */}
      <div className="hidden md:flex w-64 flex-col border-r bg-sidebar">
        {/* Header skeleton */}
        <div className="h-16 border-b flex items-center px-4 gap-2">
          <div className="w-8 h-8 rounded-lg bg-muted animate-pulse" />
          <div className="h-4 w-16 bg-muted rounded animate-pulse" />
        </div>
        {/* Nav skeleton */}
        <div className="flex-1 p-4 space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-10 bg-muted rounded animate-pulse" />
          ))}
        </div>
        {/* Footer skeleton */}
        <div className="border-t p-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-20 bg-muted rounded animate-pulse" />
              <div className="h-2 w-28 bg-muted rounded animate-pulse" />
            </div>
          </div>
        </div>
      </div>
      {/* Main content skeleton */}
      <div className="flex-1 flex flex-col">
        {/* Header skeleton */}
        <div className="h-16 border-b flex items-center justify-between px-6">
          <div className="h-4 w-32 bg-muted rounded animate-pulse" />
          <div className="h-8 w-20 bg-muted rounded animate-pulse" />
        </div>
        {/* Content skeleton */}
        <div className="flex-1 p-6 space-y-4">
          <div className="h-8 w-48 bg-muted rounded animate-pulse" />
          <div className="h-4 w-64 bg-muted rounded animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-32 bg-muted rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
})

/**
 * Full-screen loading state for auth check.
 * Shows either a shell skeleton or simple spinner based on context.
 * Respects reduced motion preference for animations.
 */
const AuthLoadingState = memo(function AuthLoadingState() {
  const prefersReducedMotion = useReducedMotion()

  // Use shell skeleton for a more polished loading experience
  if (!prefersReducedMotion) {
    return (
      <div
        data-testid="admin-loading"
        role="status"
        aria-label="Loading authentication status"
      >
        <ShellSkeleton />
      </div>
    )
  }

  // Simplified loading for reduced motion users
  return (
    <div
      data-testid="admin-loading"
      className="min-h-screen flex flex-col items-center justify-center bg-background gap-4"
      role="status"
      aria-label="Loading authentication status"
    >
      <div
        className="rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"
        aria-hidden="true"
      />
      <p className="text-sm text-muted-foreground">Loading...</p>
    </div>
  )
})

// =============================================================================
// Error State Component
// =============================================================================

/**
 * Full-screen error state for auth failures.
 * Provides retry and support options.
 */
const AuthErrorState = memo(function AuthErrorState({ error }: { error: string }) {
  const handleRetry = useCallback(() => {
    window.location.reload()
  }, [])

  return (
    <div
      data-testid="admin-error"
      className="min-h-screen flex items-center justify-center bg-background text-foreground p-6"
      role="alert"
    >
      <div className="text-center max-w-md">
        <div className="text-4xl mb-4" aria-hidden="true">&#9888;</div>
        <h1 className="text-xl font-semibold text-destructive mb-2">Authentication Error</h1>
        <p data-testid="admin-error-message" className="text-muted-foreground mb-6">{error}</p>
        <div className="flex gap-3 justify-center">
          <Button
            variant="outline"
            onClick={handleRetry}
            data-testid="admin-error-retry"
          >
            Try Again
          </Button>
          <Button
            asChild
            variant="ghost"
          >
            <RouterLink to="/admin/login" data-testid="admin-error-login">
              Go to Login
            </RouterLink>
          </Button>
        </div>
      </div>
    </div>
  )
})

// =============================================================================
// AuthGuard Component
// =============================================================================

/**
 * AuthGuard - Protects routes that require authentication
 *
 * Provides:
 * - Route protection with automatic redirect to login
 * - Branded loading state during auth check
 * - Graceful error handling with retry option
 * - Public route bypass for login/signup pages
 *
 * @see publicAdminRoutes from ~/lib/shell/navigation for bypass list
 */
function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, error } = useAuth()
  const location = useLocation()

  // Check if current route is public using centralized config
  const isPublicRoute = useMemo(() => {
    return publicAdminRoutes.some(
      (route) => location.pathname === route || location.pathname.startsWith(route + '/')
    )
  }, [location.pathname])

  // Public routes are always accessible (no shell)
  if (isPublicRoute) {
    return <>{children}</>
  }

  // Show loading state while checking authentication
  if (isLoading) {
    return <AuthLoadingState />
  }

  // Handle auth error state
  if (error) {
    return <AuthErrorState error={error} />
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
      <ToastProvider>
        <AuthGuard>
          <Outlet />
        </AuthGuard>
      </ToastProvider>
    </AuthProvider>
  )
}
