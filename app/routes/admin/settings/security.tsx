/**
 * Admin Security Settings Route
 *
 * Password, 2FA, and session management.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell } from '@mdxui/cockpit'

export const Route = createFileRoute('/admin/settings/security')({
  component: SecuritySettingsPage,
})

function SecuritySettingsPage() {
  return (
    <Shell>
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-6">Security Settings</h1>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Password</h3>
            <form className="max-w-lg">
              <div className="mb-4">
                <label htmlFor="current-password" className="block text-sm font-medium text-gray-700 mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  id="current-password"
                  name="currentPassword"
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              <div className="mb-4">
                <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  id="new-password"
                  name="newPassword"
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              <div className="mb-4">
                <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  id="confirm-password"
                  name="confirmPassword"
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                Update Password
              </button>
            </form>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Two-Factor Authentication (2FA/MFA)</h3>
            <p className="text-gray-600 mb-4">Add an extra layer of security to your account.</p>
            <div className="flex items-center gap-4">
              <span className="text-gray-500">Status: Disabled</span>
              <button className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
                Enable 2FA
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Active Sessions</h3>
            <p className="text-gray-600 mb-4">Manage devices and sessions where you're logged in.</p>
            <ul className="space-y-3 mb-4">
              <li className="flex items-center justify-between py-2 border-b">
                <div>
                  <p className="font-medium">Chrome on macOS (Current Device)</p>
                  <p className="text-sm text-gray-500">Last active: Just now</p>
                </div>
              </li>
              <li className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium">Safari on iPhone</p>
                  <p className="text-sm text-gray-500">Last active: 2 hours ago</p>
                </div>
                <button className="text-red-600 hover:underline">Revoke</button>
              </li>
            </ul>
            <button className="text-red-600 hover:underline">Sign Out All Other Sessions</button>
          </div>
        </div>
      </div>
    </Shell>
  )
}
