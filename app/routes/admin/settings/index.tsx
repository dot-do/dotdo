/**
 * Admin Settings Index Route
 *
 * Settings overview with links to various setting sections.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell, SettingsPage } from '~/components/ui/shell'

export const Route = createFileRoute('/admin/settings/')({
  component: SettingsIndexPage,
})

function SettingsIndexPage() {
  return (
    <Shell>
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-6">Settings</h1>

        <div className="grid grid-cols-3 gap-6">
          <a
            href="/admin/settings/account"
            className="bg-card rounded-lg shadow p-6 hover:shadow-lg transition-shadow"
          >
            <h3 className="text-lg font-semibold mb-2">Account & Profile</h3>
            <p className="text-muted-foreground">Manage your personal information and preferences.</p>
          </a>

          <a
            href="/admin/settings/security"
            className="bg-card rounded-lg shadow p-6 hover:shadow-lg transition-shadow"
          >
            <h3 className="text-lg font-semibold mb-2">Security & Password</h3>
            <p className="text-muted-foreground">Update password, Two-Factor authentication (2FA), and sessions.</p>
          </a>

          <div className="bg-card rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-2">Notification Preferences</h3>
            <p className="text-muted-foreground">Configure Email alerts and notifications.</p>
          </div>

          <a
            href="/admin/settings/appearance"
            className="bg-card rounded-lg shadow p-6 hover:shadow-lg transition-shadow"
          >
            <h3 className="text-lg font-semibold mb-2">Appearance & Theme</h3>
            <p className="text-muted-foreground">Customize the look with Dark Mode and themes.</p>
          </a>
        </div>
      </div>
    </Shell>
  )
}
