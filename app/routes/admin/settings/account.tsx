/**
 * Admin Account Settings Route
 *
 * User profile and account settings.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell, UserProfile } from '~/components/ui/shell'
import { Button } from '~/components/ui/button'

export const Route = createFileRoute('/admin/settings/account')({
  component: AccountSettingsPage,
})

function AccountSettingsPage() {
  return (
    <Shell>
      <div className="p-6" data-testid="settings-content">
        <h1 className="text-2xl font-semibold mb-6">Account Settings</h1>

        <form className="bg-card rounded-lg shadow p-6 max-w-lg" data-testid="settings-form-account">
          <div className="mb-6">
            <label htmlFor="avatar" className="block text-sm font-medium mb-2">
              Profile Photo
            </label>
            <div className="flex items-center gap-4">
              <img src="/avatar.png" alt="Current avatar" className="w-16 h-16 rounded-full" data-testid="settings-avatar" />
              <Button type="button" variant="outline" data-testid="settings-avatar-change">
                Change
              </Button>
            </div>
          </div>

          <div className="mb-4">
            <label htmlFor="name" className="block text-sm font-medium mb-1">
              Name
            </label>
            <input
              type="text"
              id="name"
              name="name"
              defaultValue="John Doe"
              className="w-full border rounded px-3 py-2 bg-input"
              data-testid="settings-input-name"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              Email
            </label>
            <input
              type="email"
              id="email"
              name="email"
              defaultValue="john@example.com.ai"
              readOnly
              className="w-full border rounded px-3 py-2 bg-muted"
              data-testid="settings-input-email"
            />
            <p className="text-sm text-muted-foreground mt-1">Contact support to change your email.</p>
          </div>

          <div className="flex gap-3">
            <Button type="submit" data-testid="settings-save-button">
              Save Changes
            </Button>
            <Button type="button" variant="outline" data-testid="settings-cancel-button">
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </Shell>
  )
}
