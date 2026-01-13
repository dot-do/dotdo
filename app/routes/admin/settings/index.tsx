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
      <div className="p-6" data-testid="settings-layout">
        <h1 className="text-2xl font-semibold mb-6">Settings</h1>

        <nav className="grid grid-cols-3 gap-6" data-testid="settings-nav">
          <a
            href="/admin/settings/account"
            className="bg-card rounded-lg shadow p-6 hover:shadow-lg transition-shadow"
            data-testid="settings-tab-account"
          >
            <h3 className="text-lg font-semibold mb-2">Account & Profile</h3>
            <p className="text-muted-foreground">Manage your personal information and preferences.</p>
          </a>

          <a
            href="/admin/settings/security"
            className="bg-card rounded-lg shadow p-6 hover:shadow-lg transition-shadow"
            data-testid="settings-tab-security"
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
            data-testid="settings-tab-appearance"
          >
            <h3 className="text-lg font-semibold mb-2">Appearance & Theme</h3>
            <p className="text-muted-foreground">Customize the look with Dark Mode and themes.</p>
          </a>

          <a
            href="/admin/integrations/api-keys"
            className="bg-card rounded-lg shadow p-6 hover:shadow-lg transition-shadow"
            data-testid="settings-tab-api-keys"
          >
            <h3 className="text-lg font-semibold mb-2">API Keys</h3>
            <p className="text-muted-foreground">Manage API keys for programmatic access.</p>
          </a>
        </nav>
      </div>
    </Shell>
  )
}
