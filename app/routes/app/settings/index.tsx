/**
 * Settings Index Route
 *
 * Account settings page at /app/settings.
 */

import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '../_app'

export const Route = createFileRoute('/app/settings/')({
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <>
      <PageHeader />
      <div className="flex-1 overflow-auto p-4 pt-0">
        <div data-testid="app-page-title" className="mb-2">
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>
        <p data-testid="app-page-description" className="text-muted-foreground mb-6">
          Account settings
        </p>

        {/* Settings form placeholder */}
        <div className="space-y-6">
          <div className="rounded-lg border p-6">
            <h2 className="text-lg font-semibold mb-4">Profile</h2>
            <div className="grid gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Name</label>
                <p className="text-sm">John Doe</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Email</label>
                <p className="text-sm">john@example.com</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border p-6">
            <h2 className="text-lg font-semibold mb-4">Preferences</h2>
            <div className="grid gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Theme</label>
                <p className="text-sm">System</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Language</label>
                <p className="text-sm">English</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
