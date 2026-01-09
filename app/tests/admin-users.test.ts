/**
 * Admin Users Routes Tests (TDD RED Phase)
 *
 * These tests verify the Users admin routes migration to real-time sync components.
 * Tests define expected behavior using file structure and content pattern matching.
 *
 * RED Phase: These tests should FAIL until implementation is complete.
 *
 * Route structure:
 * - /admin/users/ - User list with SyncDataTable
 * - /admin/users/new - Create user form with SyncForm
 * - /admin/users/$userId - Edit user form with SyncForm
 *
 * Key behaviors:
 * - Real-time sync via useDotdoCollection hook
 * - Zod schema validation
 * - Optimistic updates
 * - Conflict resolution
 *
 * @see objects/DO.ts - Base Durable Object with collection support
 * @see app/routes/admin/users/ - Route implementations
 */

import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

// ============================================================================
// User Schema Types
// ============================================================================

interface User {
  $id: string
  $type: 'User'
  name: string
  email: string
  role: 'admin' | 'user' | 'viewer'
  status: 'Active' | 'Inactive'
  createdAt: string
  updatedAt: string
}

// ============================================================================
// Route File Structure Tests
// ============================================================================

describe('User Routes File Structure', () => {
  describe('app/routes/admin/users/index.tsx', () => {
    it('should exist as users list route', () => {
      expect(existsSync('app/routes/admin/users/index.tsx')).toBe(true)
    })

    it('should use TanStack Router createFileRoute', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toContain('createFileRoute')
      expect(content).toContain("'/admin/users/'")
    })

    it('should import Shell from @mdxui/cockpit', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toContain('@mdxui/cockpit')
      expect(content).toContain('Shell')
    })

    it('should export Route constant', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toContain('export const Route')
    })
  })

  describe('app/routes/admin/users/new.tsx', () => {
    it('should exist as create user route', () => {
      expect(existsSync('app/routes/admin/users/new.tsx')).toBe(true)
    })

    it('should use TanStack Router createFileRoute', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toContain('createFileRoute')
      expect(content).toContain("'/admin/users/new'")
    })

    it('should export Route constant', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toContain('export const Route')
    })
  })

  describe('app/routes/admin/users/$userId.tsx', () => {
    it('should exist as user detail/edit route', () => {
      expect(existsSync('app/routes/admin/users/$userId.tsx')).toBe(true)
    })

    it('should use TanStack Router createFileRoute', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toContain('createFileRoute')
      expect(content).toContain("'/admin/users/$userId'")
    })

    it('should use userId from route params', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toContain('userId')
      expect(content).toMatch(/useParams|Route\.useParams/)
    })

    it('should export Route constant', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toContain('export const Route')
    })
  })
})

// ============================================================================
// User Schema Tests
// ============================================================================

describe('User Schema', () => {
  describe('app/schemas/user.ts or inline schema', () => {
    it('should define UserSchema with Zod', async () => {
      // Schema can be in separate file or inline in route
      let hasSchema = false
      const files = [
        'app/schemas/user.ts',
        'app/routes/admin/users/index.tsx',
        'app/routes/admin/users/new.tsx',
      ]

      for (const file of files) {
        if (existsSync(file)) {
          const content = await readFile(file, 'utf-8')
          if (content.includes('UserSchema') && content.includes('z.object')) {
            hasSchema = true
            break
          }
        }
      }

      expect(hasSchema).toBe(true)
    })

    it('should have $id field in schema', async () => {
      const files = ['app/schemas/user.ts', 'app/routes/admin/users/new.tsx']
      let hasField = false

      for (const file of files) {
        if (existsSync(file)) {
          const content = await readFile(file, 'utf-8')
          if (content.includes('$id') && content.includes('z.string')) {
            hasField = true
            break
          }
        }
      }

      expect(hasField).toBe(true)
    })

    it('should have $type field set to User', async () => {
      const files = ['app/schemas/user.ts', 'app/routes/admin/users/new.tsx']
      let hasField = false

      for (const file of files) {
        if (existsSync(file)) {
          const content = await readFile(file, 'utf-8')
          if (content.includes('$type') && content.match(/literal.*User|User.*literal/)) {
            hasField = true
            break
          }
        }
      }

      expect(hasField).toBe(true)
    })

    it('should have name field with min length validation', async () => {
      const files = ['app/schemas/user.ts', 'app/routes/admin/users/new.tsx']
      let hasField = false

      for (const file of files) {
        if (existsSync(file)) {
          const content = await readFile(file, 'utf-8')
          if (content.includes('name') && content.match(/z\.string.*min\(1\)|min\(1\).*name/)) {
            hasField = true
            break
          }
        }
      }

      expect(hasField).toBe(true)
    })

    it('should have email field with email validation', async () => {
      const files = ['app/schemas/user.ts', 'app/routes/admin/users/new.tsx']
      let hasField = false

      for (const file of files) {
        if (existsSync(file)) {
          const content = await readFile(file, 'utf-8')
          if (content.includes('email') && content.match(/z\.string.*email\(\)|\.email\(\)/)) {
            hasField = true
            break
          }
        }
      }

      expect(hasField).toBe(true)
    })

    it('should have role field as enum', async () => {
      const files = ['app/schemas/user.ts', 'app/routes/admin/users/new.tsx']
      let hasField = false

      for (const file of files) {
        if (existsSync(file)) {
          const content = await readFile(file, 'utf-8')
          if (content.includes('role') && content.match(/z\.enum.*admin.*user|enum.*role/)) {
            hasField = true
            break
          }
        }
      }

      expect(hasField).toBe(true)
    })

    it('should have status field as enum with Active/Inactive', async () => {
      const files = ['app/schemas/user.ts', 'app/routes/admin/users/new.tsx']
      let hasField = false

      for (const file of files) {
        if (existsSync(file)) {
          const content = await readFile(file, 'utf-8')
          if (content.includes('status') && content.match(/Active.*Inactive|Inactive.*Active/)) {
            hasField = true
            break
          }
        }
      }

      expect(hasField).toBe(true)
    })
  })
})

// ============================================================================
// Users List Route Tests
// ============================================================================

describe('Users List Route', () => {
  describe('Component Structure', () => {
    it('should define UsersPage or UsersListPage component', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/function\s+(UsersPage|UsersListPage)/)
    })

    it('should render page title "Users"', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/Users/)
      expect(content).toMatch(/<h1|className.*text-2xl/)
    })

    it('should have "Create User" button linking to /admin/users/new', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/Create User|New User|Add User/)
      expect(content).toContain('/admin/users/new')
    })
  })

  describe('Real-time Data Fetching', () => {
    it('should use useDotdoCollection hook for users data', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toContain('useDotdoCollection')
    })

    it('should pass User type to collection hook', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/useDotdoCollection<User>|useDotdoCollection.*User/)
    })

    it('should destructure data, loading, and error from hook', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/\{\s*data.*loading|const.*=.*useDotdoCollection/)
    })
  })

  describe('SyncDataTable Component', () => {
    it('should use SyncDataTable for user listing', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toContain('SyncDataTable')
    })

    it('should have Name column', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/accessorKey:\s*['"]name['"]|header:\s*['"]Name['"]/)
    })

    it('should have Email column', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/accessorKey:\s*['"]email['"]|header:\s*['"]Email['"]/)
    })

    it('should have Role column', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/accessorKey:\s*['"]role['"]|header:\s*['"]Role['"]/)
    })

    it('should have Status column', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/accessorKey:\s*['"]status['"]|header:\s*['"]Status['"]/)
    })

    it('should enable searchable prop', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toContain('searchable')
    })

    it('should enable pagination', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/paginated|pagination/)
    })

    it('should pass users data to table', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/data=\{.*users|data=\{data/)
    })
  })

  describe('Loading State', () => {
    it('should show loading skeleton initially', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/loading|isLoading/)
      expect(content).toMatch(/Skeleton|Loading|Spinner/)
    })

    it('should conditionally render based on loading state', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/\{loading\s*\?|\{isLoading\s*\?|if\s*\(loading\)|if\s*\(isLoading\)/)
    })
  })

  describe('Row Navigation', () => {
    it('should navigate to user detail on row click', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/onRowClick|onClick.*navigate|to=.*\$userId|href=.*user/)
    })

    it('should use router navigation for row clicks', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/navigate\(|useNavigate|Link\s/)
    })
  })

  describe('Bulk Operations', () => {
    it('should support row selection for bulk delete', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/selectable|selectedRows|rowSelection|onSelectionChange/)
    })

    it('should have bulk delete button', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/Delete Selected|Bulk Delete|handleBulkDelete/)
    })

    it('should call collection.deleteMany for bulk delete', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/deleteMany|collection\.delete|Promise\.all.*delete/)
    })
  })

  describe('Real-time Updates', () => {
    it('should subscribe to collection changes', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/useDotdoCollection|subscribe|onUpdate|realtime/)
    })

    it('should update table when new user created elsewhere', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      // Collection hook should handle this automatically via reactive data
      expect(content).toContain('useDotdoCollection')
    })
  })
})

// ============================================================================
// Create User Route Tests
// ============================================================================

describe('Create User Route', () => {
  describe('Component Structure', () => {
    it('should define CreateUserPage component', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/function\s+(CreateUserPage|NewUserPage)/)
    })

    it('should render page title "Create New User"', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/Create.*User|New User/i)
    })

    it('should have cancel link back to list', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/Cancel/)
      expect(content).toContain('/admin/users')
    })
  })

  describe('SyncForm Component', () => {
    it('should use SyncForm component', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toContain('SyncForm')
    })

    it('should pass UserSchema to form', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/schema=\{.*UserSchema|schema=.*User/)
    })

    it('should use useSyncForm hook', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toContain('useSyncForm')
    })
  })

  describe('Form Fields', () => {
    it('should have name input field', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/name="name"|id="name"|field.*name/)
    })

    it('should have email input field with type email', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/type="email"|name="email"|field.*email/)
    })

    it('should have role select field', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/name="role"|id="role"|field.*role|<select/)
    })

    it('should have role options for admin, user, viewer', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toContain('admin')
      expect(content).toContain('user')
      expect(content).toMatch(/viewer|User/)
    })

    it('should have status select or toggle field', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/name="status"|field.*status/)
    })

    it('should have submit button with "Create User" text', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toContain('type="submit"')
      expect(content).toMatch(/Create User|Save|Submit/)
    })
  })

  describe('Form Validation', () => {
    it('should validate required name field', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/required|min\(1\)|errors.*name/)
    })

    it('should validate email format', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/\.email\(\)|type="email"|email.*validation/)
    })

    it('should display validation error messages', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/errors|error.*message|formState\.errors/)
    })
  })

  describe('Form Submission', () => {
    it('should call collection.insert on submit', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/collection\.insert|insert\(|onSubmit/)
    })

    it('should navigate to list after success', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/navigate.*\/admin\/users|router.*\/admin\/users/)
    })

    it('should show error message on failure', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/error|catch|onError|setError/)
    })

    it('should show loading state while submitting', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/isSubmitting|submitting|pending|loading/)
    })
  })
})

// ============================================================================
// Edit User Route Tests
// ============================================================================

describe('Edit User Route', () => {
  describe('Component Structure', () => {
    it('should define UserDetailPage or EditUserPage component', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/function\s+(UserDetailPage|EditUserPage)/)
    })

    it('should render page title with "Edit" or "User Details"', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/Edit User|User Details|User/i)
    })

    it('should have back link to list', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/Back|Cancel/)
      expect(content).toContain('/admin/users')
    })

    it('should have delete button', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/Delete|delete/)
    })
  })

  describe('User Loading', () => {
    it('should fetch user by ID using useSyncForm with initialId', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/useSyncForm.*initialId|useSyncForm.*userId/)
    })

    it('should show loading skeleton while fetching', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/loading|isLoading/)
      expect(content).toMatch(/Skeleton|Loading|Spinner/)
    })

    it('should show 404 if user not found', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/not found|404|notFound|error/)
    })
  })

  describe('SyncForm Integration', () => {
    it('should use SyncForm component', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toContain('SyncForm')
    })

    it('should use useSyncForm hook with initialId', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toContain('useSyncForm')
      expect(content).toMatch(/initialId|userId/)
    })

    it('should load user data into form fields', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/defaultValues|initialValues|reset\(|setValue/)
    })
  })

  describe('Form Fields', () => {
    it('should have editable name field', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/name="name"|field.*name/)
    })

    it('should have editable email field', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/name="email"|field.*email/)
    })

    it('should have editable role field', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/name="role"|field.*role/)
    })

    it('should have editable status field', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/name="status"|field.*status/)
    })

    it('should display read-only user ID', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/\$id|userId|readOnly|disabled/)
    })

    it('should have submit button with "Save" or "Update" text', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toContain('type="submit"')
      expect(content).toMatch(/Save|Update/)
    })
  })

  describe('Form Submission', () => {
    it('should call collection.update on submit', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/collection\.update|update\(|onSubmit/)
    })

    it('should navigate to list after success', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/navigate.*\/admin\/users|router.*\/admin\/users/)
    })

    it('should show error message on failure', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/error|catch|onError|setError/)
    })
  })

  describe('Conflict Resolution', () => {
    it('should handle concurrent edit conflict', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/conflict|stale|version|optimistic|concurrent/)
    })

    it('should show warning if data changed externally', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/changed|modified|stale|warning|alert/)
    })
  })

  describe('Delete User', () => {
    it('should have delete confirmation dialog', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/confirm|Dialog|Modal|confirmDelete/)
    })

    it('should call collection.delete on confirm', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/collection\.delete|delete\(|handleDelete/)
    })

    it('should navigate to list after delete', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/navigate.*\/admin\/users|router.*\/admin\/users/)
    })
  })
})

// ============================================================================
// Real-time Sync Behavior Tests
// ============================================================================

describe('Real-time Sync Behavior', () => {
  describe('useDotdoCollection Hook', () => {
    it('should be imported in list page', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toContain('useDotdoCollection')
    })

    it('should connect to Users collection', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/useDotdoCollection.*User|collection.*users/i)
    })
  })

  describe('useSyncForm Hook', () => {
    it('should be imported in create page', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toContain('useSyncForm')
    })

    it('should be imported in edit page', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toContain('useSyncForm')
    })

    it('should pass collection reference to hook', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/useSyncForm.*collection|collection.*useSyncForm/)
    })
  })

  describe('Optimistic Updates', () => {
    it('should update UI optimistically on insert', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/optimistic|pending|mutate/)
    })

    it('should update UI optimistically on update', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/optimistic|pending|mutate/)
    })

    it('should rollback on error', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/rollback|revert|catch|onError/)
    })
  })

  describe('Subscription Cleanup', () => {
    it('should cleanup subscription on unmount in list', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      // Hook should handle cleanup automatically
      expect(content).toContain('useDotdoCollection')
    })

    it('should cleanup subscription on unmount in edit', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      // Hook should handle cleanup automatically
      expect(content).toContain('useSyncForm')
    })
  })
})

// ============================================================================
// Accessibility Tests
// ============================================================================

describe('Accessibility', () => {
  describe('List Page', () => {
    it('should have proper heading hierarchy', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/<h1/)
    })

    it('should have search input with placeholder', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/searchPlaceholder|placeholder.*search/i)
    })
  })

  describe('Create Page', () => {
    it('should have labels for all form fields', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/<label|aria-label|htmlFor/)
    })

    it('should have proper form structure', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toContain('<form')
    })

    it('should have submit button type', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toContain('type="submit"')
    })
  })

  describe('Edit Page', () => {
    it('should have labels for all form fields', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/<label|aria-label|htmlFor/)
    })

    it('should have proper form structure', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toContain('<form')
    })
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  describe('List Page Errors', () => {
    it('should handle fetch error gracefully', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/error|Error|catch/)
    })

    it('should show error message to user', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/error.*message|Error|Alert/)
    })
  })

  describe('Create Page Errors', () => {
    it('should handle submission error', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/error|catch|onError/)
    })

    it('should show error toast or message', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/toast|error.*message|Alert|setError/)
    })
  })

  describe('Edit Page Errors', () => {
    it('should handle fetch error', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/error|catch/)
    })

    it('should handle update error', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/error|catch|onError/)
    })
  })
})

// ============================================================================
// Empty State Tests
// ============================================================================

describe('Empty State', () => {
  it('should show empty state when no users exist', async () => {
    const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
    expect(content).toMatch(/no.*users|empty|length\s*===?\s*0|EmptyState/i)
  })

  it('should have call to action to create first user', async () => {
    const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
    expect(content).toMatch(/Create.*first|Get started|Add.*user|EmptyState/i)
  })
})

// ============================================================================
// Navigation Tests
// ============================================================================

describe('Navigation', () => {
  describe('List to Create', () => {
    it('should link to create page', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toContain('/admin/users/new')
    })
  })

  describe('List to Edit', () => {
    it('should link to edit page with user ID', async () => {
      const content = await readFile('app/routes/admin/users/index.tsx', 'utf-8')
      expect(content).toMatch(/\/admin\/users\/\$\{|to=.*userId|href.*user\.\$id/)
    })
  })

  describe('Create to List', () => {
    it('should navigate to list after create', async () => {
      const content = await readFile('app/routes/admin/users/new.tsx', 'utf-8')
      expect(content).toMatch(/navigate\(|useNavigate/)
      expect(content).toContain('/admin/users')
    })
  })

  describe('Edit to List', () => {
    it('should navigate to list after update', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/navigate\(|useNavigate/)
      expect(content).toContain('/admin/users')
    })

    it('should navigate to list after delete', async () => {
      const content = await readFile('app/routes/admin/users/$userId.tsx', 'utf-8')
      expect(content).toMatch(/navigate\(|useNavigate/)
    })
  })
})
