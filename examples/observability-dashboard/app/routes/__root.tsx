import { createRootRoute, Outlet, HeadContent, Scripts } from '@tanstack/react-router'
import * as React from 'react'

export const Route = createRootRoute({
  component: RootComponent,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
      { title: 'Observability Dashboard - Unified Events' },
    ],
  }),
})

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <style dangerouslySetInnerHTML={{ __html: globalStyles }} />
      </head>
      <body>
        <div className="app">
          <nav className="sidebar">
            <div className="logo">Observability</div>
            <ul className="nav-links">
              <li><a href="/">Dashboard</a></li>
              <li><a href="/traces">Traces</a></li>
              <li><a href="/logs">Logs</a></li>
            </ul>
          </nav>
          <main className="content">
            <Outlet />
          </main>
        </div>
        <Scripts />
      </body>
    </html>
  )
}

const globalStyles = `
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0d1117;
    color: #c9d1d9;
    line-height: 1.5;
  }

  .app {
    display: flex;
    min-height: 100vh;
  }

  .sidebar {
    width: 220px;
    background: #161b22;
    border-right: 1px solid #30363d;
    padding: 1rem;
  }

  .logo {
    font-size: 1.25rem;
    font-weight: 600;
    color: #58a6ff;
    margin-bottom: 2rem;
    padding: 0.5rem;
  }

  .nav-links {
    list-style: none;
  }

  .nav-links li {
    margin-bottom: 0.5rem;
  }

  .nav-links a {
    display: block;
    padding: 0.75rem 1rem;
    color: #c9d1d9;
    text-decoration: none;
    border-radius: 6px;
    transition: background 0.15s;
  }

  .nav-links a:hover {
    background: #21262d;
  }

  .content {
    flex: 1;
    padding: 2rem;
    overflow-x: hidden;
  }

  h1 {
    font-size: 1.75rem;
    margin-bottom: 1.5rem;
    color: #f0f6fc;
  }

  h2 {
    font-size: 1.25rem;
    margin-bottom: 1rem;
    color: #f0f6fc;
  }

  .card {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
  }

  .stat-value {
    font-size: 2rem;
    font-weight: 600;
    color: #58a6ff;
  }

  .stat-label {
    font-size: 0.875rem;
    color: #8b949e;
    margin-top: 0.25rem;
  }

  .event-list {
    max-height: 400px;
    overflow-y: auto;
  }

  .event-item {
    padding: 0.75rem;
    border-bottom: 1px solid #30363d;
    font-family: monospace;
    font-size: 0.875rem;
  }

  .event-item:last-child {
    border-bottom: none;
  }

  .event-type {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    margin-right: 0.5rem;
  }

  .event-type.trace { background: #238636; color: #fff; }
  .event-type.log { background: #1f6feb; color: #fff; }
  .event-type.metric { background: #8957e5; color: #fff; }
  .event-type.cdc { background: #f78166; color: #fff; }
  .event-type.track { background: #d29922; color: #000; }

  .timestamp {
    color: #8b949e;
    font-size: 0.75rem;
  }

  .trace-waterfall {
    padding: 1rem 0;
  }

  .span-row {
    display: flex;
    align-items: center;
    padding: 0.5rem 0;
    border-bottom: 1px solid #21262d;
  }

  .span-name {
    width: 200px;
    font-size: 0.875rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .span-bar-container {
    flex: 1;
    height: 24px;
    background: #21262d;
    border-radius: 4px;
    position: relative;
    margin-left: 1rem;
  }

  .span-bar {
    height: 100%;
    border-radius: 4px;
    position: absolute;
    min-width: 4px;
  }

  .span-bar.success { background: #238636; }
  .span-bar.error { background: #f85149; }

  .span-duration {
    width: 80px;
    text-align: right;
    font-size: 0.75rem;
    color: #8b949e;
    margin-left: 1rem;
  }

  .log-level {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    margin-right: 0.5rem;
    text-transform: uppercase;
  }

  .log-level.debug { background: #21262d; color: #8b949e; }
  .log-level.info { background: #1f6feb; color: #fff; }
  .log-level.warn { background: #d29922; color: #000; }
  .log-level.error { background: #f85149; color: #fff; }

  .connection-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .status-dot.connected { background: #238636; }
  .status-dot.disconnected { background: #f85149; }
  .status-dot.connecting { background: #d29922; }

  .filter-bar {
    display: flex;
    gap: 1rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }

  .filter-bar input,
  .filter-bar select {
    padding: 0.5rem 0.75rem;
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #c9d1d9;
    font-size: 0.875rem;
  }

  .filter-bar input:focus,
  .filter-bar select:focus {
    outline: none;
    border-color: #58a6ff;
  }

  button {
    padding: 0.5rem 1rem;
    background: #238636;
    border: none;
    border-radius: 6px;
    color: #fff;
    font-size: 0.875rem;
    cursor: pointer;
    transition: background 0.15s;
  }

  button:hover {
    background: #2ea043;
  }

  button.secondary {
    background: #21262d;
    border: 1px solid #30363d;
  }

  button.secondary:hover {
    background: #30363d;
  }
`
