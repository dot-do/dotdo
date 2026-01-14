/**
 * App dashboard component for gitx.do
 *
 * Repository browser dashboard using @mdxui/cockpit:
 * - Repository listing and management
 * - Commit history viewer
 * - Branch and tag management
 * - File tree browser
 * - Diff viewer
 * - Clone/push/pull actions
 */

import { DeveloperDashboard, type DashboardConfig } from '@mdxui/cockpit'

const config: DashboardConfig = {
  branding: {
    name: 'gitx.do',
    logo: <span className="font-bold">gitx.do</span>,
  },
  identity: {
    clientId: 'gitx',
    devMode: process.env.NODE_ENV === 'development',
  },
  routes: {
    overview: true,
    requests: false,
    keys: true,
    team: false,
    billing: false,
    settings: true,
    webhooks: true,
    database: false,
    vault: false,
  },
}

export default function App() {
  return <DeveloperDashboard config={config} />
}
