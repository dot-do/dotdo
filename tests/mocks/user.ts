/**
 * Mock User Data
 *
 * Development mock data for user detail pages.
 * Used during development until real API integration is complete.
 *
 * @see app/routes/admin/users/$userId.tsx
 */

export interface MockUser {
  id: string
  name: string
  email: string
  role: string
  status: 'Active' | 'Inactive' | 'Pending'
  avatar?: string
  createdAt?: Date
}

export interface MockActivityItem {
  id: string
  timestamp: string
  description: string
}

/**
 * Get mock user data for development/demo purposes.
 */
export function getMockUser(userId: string): MockUser {
  return {
    id: userId,
    name: 'John Doe',
    email: 'john@example.com.ai',
    role: 'Admin',
    status: 'Active',
  }
}

/**
 * Get mock activity history for a user.
 */
export function getMockUserActivity(_userId: string): MockActivityItem[] {
  return [
    {
      id: '1',
      timestamp: '2 hours ago',
      description: 'Updated profile settings',
    },
    {
      id: '2',
      timestamp: '1 day ago',
      description: 'Created new workflow',
    },
  ]
}
