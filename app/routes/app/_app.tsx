'use client'

/**
 * App Layout Route
 *
 * Layout route that wraps all /app routes with the AppShell from @mdxui/app.
 * This is the user-facing app shell, distinct from the admin shell.
 *
 * ## Navigation
 * - Dashboard (/app)
 * - Projects (/app/projects)
 * - Workflows (/app/workflows)
 * - Settings (/app/settings)
 *
 * ## Components
 * Uses @mdxui/app components with custom wrappers for data-testid attributes:
 * - AppShell wrapper with app-shell testid
 * - Custom sidebar components for navigation
 * - AppBreadcrumbs for path-based breadcrumbs
 * - User menu in sidebar footer
 */

import { createFileRoute, Outlet, Link, useLocation, useNavigate, Navigate } from '@tanstack/react-router'
import type { ReactNode, ComponentType } from 'react'
import { AuthProvider, useAuth } from '~/src/admin/auth'
import { Button } from '@mdxui/primitives/button'
import {
  LayoutDashboard,
  FolderKanban,
  Workflow,
  Settings,
  ChevronsUpDown,
  BadgeCheck,
  CreditCard,
  LogOut,
  ChevronRight,
  Shield,
} from 'lucide-react'
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
  SidebarTrigger,
  useSidebar,
  SidebarGroup,
  SidebarGroupLabel,
} from '@mdxui/primitives/sidebar'
import { Separator } from '@mdxui/primitives/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mdxui/primitives/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@mdxui/primitives/avatar'

export const Route = createFileRoute('/app/_app')({
  component: AppLayout,
})

// ============================================================================
// Types
// ============================================================================

interface NavItem {
  title: string
  url: string
  icon: ComponentType<{ className?: string }>
  testId: string
}

interface BreadcrumbItemData {
  label: string
  href?: string
}

interface PageMeta {
  title?: string
  description?: string
  actions?: ReactNode
}

// ============================================================================
// Navigation Configuration
// ============================================================================

const navItems: NavItem[] = [
  { title: 'Dashboard', url: '/app', icon: LayoutDashboard, testId: 'app-nav-dashboard' },
  { title: 'Projects', url: '/app/projects', icon: FolderKanban, testId: 'app-nav-projects' },
  { title: 'Workflows', url: '/app/workflows', icon: Workflow, testId: 'app-nav-workflows' },
  { title: 'Settings', url: '/app/settings', icon: Settings, testId: 'app-nav-settings' },
]

// ============================================================================
// Mock User (replace with real auth)
// ============================================================================

const mockUser = {
  id: '1',
  fullName: 'John Doe',
  email: 'john@example.com',
  avatar: '',
}

// ============================================================================
// Page Metadata by Route
// ============================================================================

const pageMetadata: Record<string, PageMeta> = {
  '/app': { title: 'Dashboard', description: 'Overview of your account' },
  '/app/projects': { title: 'Projects', description: 'Manage your projects' },
  '/app/workflows': { title: 'Workflows', description: 'Manage your workflows' },
  '/app/settings': { title: 'Settings', description: 'Account settings' },
}

// ============================================================================
// Breadcrumb Generation
// ============================================================================

const labelMap: Record<string, string> = {
  app: 'Dashboard',
  projects: 'Projects',
  workflows: 'Workflows',
  settings: 'Settings',
}

function generateBreadcrumbs(pathname: string): BreadcrumbItemData[] {
  const segments = pathname.split('/').filter(Boolean)
  const items: BreadcrumbItemData[] = []
  let currentPath = ''

  segments.forEach((segment, index) => {
    currentPath = `${currentPath}/${segment}`
    const isLast = index === segments.length - 1

    // Get label from mappings or format the segment
    let label = labelMap[segment]
    if (!label) {
      // Check if it's a numeric ID
      if (/^\d+$/.test(segment)) {
        label = `#${segment}`
      } else {
        // Capitalize and replace dashes with spaces
        label = segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ')
      }
    }

    // For /app root, always label as Dashboard
    if (segment === 'app' && index === 0) {
      items.push({
        label: 'Dashboard',
        href: isLast ? undefined : '/app',
      })
    } else {
      items.push({
        label,
        href: isLast ? undefined : currentPath,
      })
    }
  })

  return items
}

// ============================================================================
// App Breadcrumbs Component
// ============================================================================

function AppBreadcrumbs() {
  const location = useLocation()
  const items = generateBreadcrumbs(location.pathname)

  return (
    <nav aria-label="breadcrumb" data-testid="app-breadcrumbs">
      <ol className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm break-words sm:gap-2.5">
        {items.map((item, index) => (
          <li
            key={index}
            data-testid="app-breadcrumb-item"
            className="inline-flex items-center gap-1.5"
          >
            {index > 0 && (
              <ChevronRight
                data-slot="separator"
                className="size-3"
                aria-hidden="true"
              />
            )}
            {item.href ? (
              <Link
                to={item.href}
                className="hover:text-foreground transition-colors"
              >
                {item.label}
              </Link>
            ) : (
              <span
                role="link"
                aria-disabled="true"
                aria-current="page"
                className="text-foreground font-normal"
              >
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

// ============================================================================
// Navigation Component
// ============================================================================

function AppNavigation() {
  const location = useLocation()
  const currentPath = location.pathname

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Navigation</SidebarGroupLabel>
      <SidebarMenu data-testid="app-sidebar-nav">
        {navItems.map((item) => {
          // Check if this nav item is active
          const isActive =
            currentPath === item.url ||
            (item.url !== '/app' && currentPath.startsWith(item.url))

          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                isActive={isActive}
                tooltip={item.title}
              >
                <Link
                  to={item.url}
                  data-testid={item.testId}
                  data-active={isActive ? 'true' : undefined}
                  href={item.url}
                >
                  <item.icon className="size-4" />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}

// ============================================================================
// Sidebar Brand Component
// ============================================================================

function SidebarBrand() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" asChild>
          <Link to="/app" data-testid="app-sidebar-brand">
            <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
              <span className="font-bold text-sm">.do</span>
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">.do</span>
              <span className="truncate text-xs">User App</span>
            </div>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

// ============================================================================
// User Menu Component
// ============================================================================

function UserMenu() {
  const { isMobile } = useSidebar()
  const navigate = useNavigate()

  const handleLogout = () => {
    // TODO: Implement actual logout
    console.log('Logout clicked')
  }

  return (
    <SidebarMenu data-testid="app-user-menu">
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg" data-testid="app-user-avatar">
                <AvatarImage src={mockUser.avatar} alt={mockUser.fullName} />
                <AvatarFallback className="rounded-lg">
                  {mockUser.fullName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{mockUser.fullName}</span>
                <span className="truncate text-xs">{mockUser.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            data-testid="app-user-dropdown"
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={mockUser.avatar} alt={mockUser.fullName} />
                  <AvatarFallback className="rounded-lg">
                    {mockUser.fullName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span data-testid="app-user-name" className="truncate font-medium">{mockUser.fullName}</span>
                  <span className="truncate text-xs">{mockUser.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link to="/app/settings">
                  <BadgeCheck className="mr-2 size-4" />
                  Account
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/app/settings">
                  <CreditCard className="mr-2 size-4" />
                  Billing
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="mr-2 size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

// ============================================================================
// Page Header Component
// ============================================================================

function PageHeader({ children }: { children?: ReactNode }) {
  const location = useLocation()
  const meta = pageMetadata[location.pathname]

  return (
    <header
      data-testid="app-page-header"
      className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12"
    >
      <div className="flex w-full items-center justify-between gap-2 px-4">
        <div className="flex items-center gap-2">
          <SidebarTrigger
            data-testid="app-sidebar-trigger"
            className="-ml-1"
            aria-label="Toggle sidebar"
          />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-4"
          />
          <div className="flex flex-col">
            {meta?.title && (
              <h1 data-testid="app-page-title" className="text-sm font-medium">
                {meta.title}
              </h1>
            )}
            <AppBreadcrumbs />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            asChild
            variant="ghost"
            size="sm"
            data-testid="nav-link-admin"
          >
            <Link to="/admin">
              <Shield className="mr-2 h-4 w-4" />
              Admin
            </Link>
          </Button>
          {children && (
            <div data-testid="app-page-actions" className="flex items-center">
              {children}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

// ============================================================================
// App Shell Component
// ============================================================================

function AppShell({ children }: { children: ReactNode }) {
  const { state } = useSidebar()

  return (
    <div data-testid="app-shell" className="min-h-screen bg-background text-foreground">
      <Sidebar
        data-testid="app-sidebar"
        data-variant="inset"
        data-state={state}
        aria-expanded={state === 'expanded' ? 'true' : 'false'}
        variant="inset"
        collapsible="icon"
      >
        <SidebarHeader data-testid="app-sidebar-header">
          <SidebarBrand />
        </SidebarHeader>
        <SidebarContent>
          <AppNavigation />
        </SidebarContent>
        <SidebarFooter data-testid="app-sidebar-footer">
          <UserMenu />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset data-testid="app-main-content">
        {children}
      </SidebarInset>
    </div>
  )
}

// ============================================================================
// AuthGuard Component
// ============================================================================

/**
 * AuthGuard - Protects /app routes that require authentication
 *
 * Checks authentication state and either:
 * - Renders children if authenticated
 * - Shows loading state while checking auth
 * - Redirects to login if not authenticated
 */
function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, error } = useAuth()
  const location = useLocation()

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
      <div data-testid="app-error" className="min-h-screen flex items-center justify-center bg-background text-foreground">
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

  // Render protected content
  return <>{children}</>
}

// ============================================================================
// App Layout
// ============================================================================

function AppLayout() {
  return (
    <AuthProvider>
      <AuthGuard>
        <div data-sidebar-wrapper>
          <SidebarProvider defaultOpen={true}>
            <AppShell>
              <Outlet />
            </AppShell>
          </SidebarProvider>
        </div>
      </AuthGuard>
    </AuthProvider>
  )
}

// Export components for use in child routes
export { PageHeader, pageMetadata }
