/**
 * Admin Account Settings Route
 *
 * User profile and account settings.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell, UserProfile } from '~/components/ui/shell'

export const Route = createFileRoute('/admin/settings/account')({
  component: AccountSettingsPage,
})

function AccountSettingsPage() {
  return (
    <Shell>
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-6">Account Settings</h1>

        <form className="bg-white rounded-lg shadow p-6 max-w-lg">
          <div className="mb-6">
            <label htmlFor="avatar" className="block text-sm font-medium text-gray-700 mb-2">
              Profile Photo
            </label>
            <div className="flex items-center gap-4">
              <img src="/avatar.png" alt="Current avatar" className="w-16 h-16 rounded-full" />
              <button type="button" className="px-4 py-2 border rounded hover:bg-gray-50">
                Change
              </button>
            </div>
          </div>

          <div className="mb-4">
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <input
              type="text"
              id="name"
              name="name"
              defaultValue="John Doe"
              className="w-full border rounded px-3 py-2"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              id="email"
              name="email"
              defaultValue="john@example.com"
              readOnly
              className="w-full border rounded px-3 py-2 bg-gray-50"
            />
            <p className="text-sm text-gray-500 mt-1">Contact support to change your email.</p>
          </div>

          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
            Save Changes
          </button>
        </form>
      </div>
    </Shell>
  )
}
