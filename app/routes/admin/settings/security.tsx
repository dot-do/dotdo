/**
 * Admin Security Settings Route
 *
 * Password, 2FA, and session management.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell } from '~/components/ui/shell'
import { Button } from '~/components/ui/button'

export const Route = createFileRoute('/admin/settings/security')({
  component: SecuritySettingsPage,
})

function SecuritySettingsPage() {
  return (
    <Shell>
      <div className='p-6' data-testid='settings-content'>
        <h1 className='text-2xl font-semibold mb-6'>Security Settings</h1>

        <div className='space-y-6'>
          <div className='bg-card rounded-lg shadow p-6'>
            <h3 className='text-lg font-semibold mb-4'>Password</h3>
            <form className='max-w-lg' data-testid='settings-form-password'>
              <div className='mb-4'>
                <label htmlFor='current-password' className='block text-sm font-medium mb-1'>
                  Current Password
                </label>
                <input type='password' id='current-password' name='currentPassword' className='w-full border rounded px-3 py-2 bg-input' data-testid='settings-input-current-password' />
              </div>
              <div className='mb-4'>
                <label htmlFor='new-password' className='block text-sm font-medium mb-1'>
                  New Password
                </label>
                <input type='password' id='new-password' name='newPassword' className='w-full border rounded px-3 py-2 bg-input' data-testid='settings-input-new-password' />
              </div>
              <div className='mb-4'>
                <label htmlFor='confirm-password' className='block text-sm font-medium mb-1'>
                  Confirm New Password
                </label>
                <input type='password' id='confirm-password' name='confirmPassword' className='w-full border rounded px-3 py-2 bg-input' data-testid='settings-input-confirm-password' />
              </div>
              <div className='flex gap-3'>
                <Button type='submit' data-testid='settings-save-button'>
                  Update Password
                </Button>
                <Button type='button' variant='outline' data-testid='settings-cancel-button'>
                  Cancel
                </Button>
              </div>
            </form>
          </div>

          <div className='bg-card rounded-lg shadow p-6' data-testid='settings-form-2fa'>
            <h3 className='text-lg font-semibold mb-4'>Two-Factor Authentication (2FA/MFA)</h3>
            <p className='text-muted-foreground mb-4'>Add an extra layer of security to your account.</p>
            <div className='flex items-center gap-4'>
              <span className='text-muted-foreground' data-testid='settings-2fa-status'>Status: Disabled</span>
              <Button type='button' data-testid='settings-2fa-enable'>
                Enable 2FA
              </Button>
            </div>
          </div>

          <div className='bg-card rounded-lg shadow p-6' data-testid='settings-sessions'>
            <h3 className='text-lg font-semibold mb-4'>Active Sessions</h3>
            <p className='text-muted-foreground mb-4'>Manage devices and sessions where you're logged in.</p>
            <ul className='space-y-3 mb-4' data-testid='settings-sessions-list'>
              <li className='flex items-center justify-between py-2 border-b' data-testid='settings-session-item'>
                <div>
                  <p className='font-medium'>Chrome on macOS (Current Device)</p>
                  <p className='text-sm text-muted-foreground'>Last active: Just now</p>
                </div>
              </li>
              <li className='flex items-center justify-between py-2' data-testid='settings-session-item'>
                <div>
                  <p className='font-medium'>Safari on iPhone</p>
                  <p className='text-sm text-muted-foreground'>Last active: 2 hours ago</p>
                </div>
                <Button type='button' variant='link' className='text-destructive p-0 h-auto' data-testid='settings-session-revoke'>
                  Revoke
                </Button>
              </li>
            </ul>
            <Button type='button' variant='link' className='text-destructive p-0 h-auto' data-testid='settings-sessions-signout-all'>
              Sign Out All Other Sessions
            </Button>
          </div>
        </div>
      </div>
    </Shell>
  )
}
