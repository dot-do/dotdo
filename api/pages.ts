/**
 * HTML Page Templates for dotdo
 *
 * Server-rendered HTML pages that match the React components
 * for landing, docs, admin, and error pages.
 */

// Base styles for all pages
const baseStyles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; background: #fff; color: #111; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
  .sr-only:focus { position: static; width: auto; height: auto; padding: 0.5rem 1rem; margin: 0; overflow: visible; clip: auto; background: #fff; z-index: 9999; }
  button { cursor: pointer; }
  img { max-width: 100%; height: auto; }
`

// Layout wrapper
const layout = (title: string, content: string, extraStyles = '') => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${baseStyles}${extraStyles}</style>
</head>
<body>
  ${content}
</body>
</html>`

// Landing page styles
const landingStyles = `
  .skip-link { background: #fff; color: #111; padding: 0.5rem 1rem; position: absolute; top: 0.5rem; left: 0.5rem; z-index: 100; border-radius: 0.25rem; }
  .skip-link:not(:focus) { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
  header { padding: 1rem 2rem; }
  nav[role="navigation"] { display: flex; align-items: center; justify-content: space-between; max-width: 80rem; margin: 0 auto; }
  .logo { font-size: 1.25rem; font-weight: bold; color: #111; display: flex; align-items: center; gap: 0.5rem; }
  .nav-links { display: flex; gap: 1.5rem; }
  .nav-links a { color: #555; }
  .mobile-menu { display: none; padding: 0.5rem; background: transparent; border: none; }
  @media (max-width: 768px) { .nav-links { display: none; } .mobile-menu { display: block; } }
  main { flex: 1; }
  .hero { padding: 5rem 2rem; text-align: center; }
  .hero h1 { font-size: 3rem; margin-bottom: 1rem; }
  .hero p { font-size: 1.25rem; color: #555; max-width: 48rem; margin: 0 auto 2rem; }
  .hero-buttons { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
  .btn { display: inline-flex; align-items: center; justify-content: center; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-weight: 500; }
  .btn-primary { background: #2563eb; color: #fff; }
  .btn-secondary { background: #f3f4f6; color: #374151; }
  .features { padding: 5rem 2rem; background: #f9fafb; }
  .features h2 { text-align: center; font-size: 2rem; margin-bottom: 3rem; }
  .feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; max-width: 80rem; margin: 0 auto; }
  .feature-card, .feature-item { background: #fff; padding: 1.5rem; border-radius: 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  article.feature-card, article.feature-item { display: block; }
  .feature-card h3 { font-size: 1.25rem; margin-bottom: 0.5rem; }
  .feature-card p { color: #555; }
  .feature-icon { width: 3rem; height: 3rem; margin-bottom: 1rem; color: #2563eb; }
  .cta, .call-to-action, .get-started { padding: 5rem 2rem; background: #2563eb; color: #fff; text-align: center; }
  .cta h2 { font-size: 2rem; margin-bottom: 1rem; }
  .cta p { font-size: 1.125rem; color: rgba(255,255,255,0.9); margin-bottom: 2rem; }
  .cta .btn { background: #fff; color: #2563eb; }
  footer { padding: 3rem 2rem; background: #111; color: #aaa; }
  .footer-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 2rem; max-width: 80rem; margin: 0 auto; }
  footer h3 { color: #fff; margin-bottom: 1rem; }
  footer a { color: #aaa; }
  footer a:hover { color: #fff; }
`

export function landingPageHtml(): string {
  const content = `
    <a href="#main-content" class="skip-link">Skip to main content</a>

    <header role="banner">
      <nav role="navigation">
        <a href="/" class="logo">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="2"/>
            <circle cx="16" cy="16" r="6" fill="currentColor"/>
          </svg>
          dotdo
        </a>
        <div class="nav-links">
          <a href="/docs">Docs</a>
          <a href="/docs/getting-started">Guide</a>
          <a href="https://github.com/dot-do/dotdo">GitHub</a>
          <a href="/admin">Dashboard</a>
          <a href="/docs" class="btn btn-primary">Get Started</a>
        </div>
        <button type="button" class="mobile-menu" aria-label="Toggle menu" aria-expanded="false">
          <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
        </button>
      </nav>
    </header>

    <main id="main-content" role="main" style="flex:1">
      <section id="hero" class="hero Hero">
        <h1>dotdo</h1>
        <p>Build stateful serverless applications with Cloudflare Durable Objects. Type-safe, scalable, and easy to use.</p>
        <div class="hero-buttons">
          <a href="/docs" class="btn btn-primary">Get Started</a>
          <a href="https://github.com/dot-do/dotdo" class="btn btn-secondary">View on GitHub</a>
        </div>
      </section>

      <section id="features" class="features Features">
        <h2>Why dotdo?</h2>
        <div class="feature-grid">
          <article class="feature-card feature-item">
            <div class="feature-icon">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
              </svg>
            </div>
            <h3>Type-Safe TypeScript</h3>
            <p>Full TypeScript support with type inference for Durable Object state and RPC methods.</p>
          </article>
          <article class="feature-card feature-item">
            <div class="feature-icon">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"/>
              </svg>
            </div>
            <h3>Stateful by Design</h3>
            <p>Built-in state management with durable storage. Your data persists across requests automatically.</p>
          </article>
          <article class="feature-card feature-item">
            <div class="feature-icon">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
              </svg>
            </div>
            <h3>Edge-Native Performance</h3>
            <p>Run your code at the edge, close to your users. Sub-millisecond latency worldwide.</p>
          </article>
          <article class="feature-card feature-item">
            <div class="feature-icon">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
            </div>
            <h3>Real-time Capable</h3>
            <p>WebSocket support out of the box. Build real-time collaborative apps with ease.</p>
          </article>
          <article class="feature-card feature-item">
            <div class="feature-icon">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
              </svg>
            </div>
            <h3>Infinitely Scalable</h3>
            <p>Scale to millions of concurrent connections. Each Durable Object handles its own state.</p>
          </article>
          <article class="feature-card feature-item">
            <div class="feature-icon">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
              </svg>
            </div>
            <h3>Great Developer Experience</h3>
            <p>Simple, intuitive API. Write less boilerplate and focus on your business logic.</p>
          </article>
        </div>
      </section>

      <section id="cta" class="cta CTA call-to-action get-started">
        <h2>Ready to build something amazing?</h2>
        <p>Get started with dotdo in minutes. No complex setup required.</p>
        <div class="hero-buttons">
          <a href="/docs" class="btn">Read the Docs</a>
          <a href="https://github.com/dot-do/dotdo" class="btn" style="border: 2px solid #fff; background: transparent; color: #fff;">Star on GitHub</a>
        </div>
      </section>
    </main>

    <footer role="contentinfo">
      <div class="footer-grid">
        <div>
          <a href="/" class="logo" style="color: #fff;">dotdo</a>
          <p style="margin-top: 1rem;">Build stateful serverless applications with Cloudflare Durable Objects.</p>
        </div>
        <div>
          <h3>Resources</h3>
          <ul style="list-style: none;">
            <li><a href="/docs">Documentation</a></li>
            <li><a href="/docs/getting-started">Getting Started</a></li>
            <li><a href="/docs/api">API Reference</a></li>
          </ul>
        </div>
        <div>
          <h3>Community</h3>
          <ul style="list-style: none;">
            <li><a href="https://github.com/dot-do/dotdo">GitHub</a></li>
            <li><a href="https://twitter.com/dotdodev">Twitter</a></li>
            <li><a href="https://discord.gg/dotdo">Discord</a></li>
          </ul>
        </div>
      </div>
      <div style="text-align: center; margin-top: 2rem; padding-top: 2rem; border-top: 1px solid #333;">
        <p>&copy; ${new Date().getFullYear()} dotdo. All rights reserved.</p>
      </div>
    </footer>

    <img src="/images/hero-bg.webp" alt="" aria-hidden="true" loading="lazy" style="display:none;" width="1920" height="1080">
  `
  return layout('dotdo - Stateful Serverless Applications', content, landingStyles)
}

// Docs page styles
const docsStyles = `
  .docs-layout { display: flex; min-height: 100vh; }
  aside.sidebar, .docs-nav, nav.sidebar, [data-sidebar] { width: 250px; padding: 1rem; background: #f9fafb; border-right: 1px solid #e5e7eb; }
  aside a { display: block; padding: 0.5rem; color: #555; border-radius: 0.25rem; }
  aside a:hover, aside a.active { background: #e5e7eb; color: #111; text-decoration: none; }
  .docs-main { flex: 1; padding: 2rem; max-width: 800px; }
  .docs-content, .prose, article, .mdx-content { line-height: 1.8; }
  .docs-content h1 { font-size: 2rem; margin-bottom: 1rem; }
  .docs-content p { margin-bottom: 1rem; }
  pre code, .code-block, [data-rehype-pretty-code] { display: block; background: #1f2937; color: #e5e7eb; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; font-family: ui-monospace, monospace; margin: 1rem 0; }
  .toc, .table-of-contents, nav[aria-label*="contents"] { position: fixed; right: 2rem; top: 6rem; width: 200px; padding: 1rem; background: #f9fafb; border-radius: 0.5rem; }
  .toc h4 { margin-bottom: 0.5rem; font-size: 0.875rem; color: #555; }
  .toc a { display: block; padding: 0.25rem 0; color: #555; font-size: 0.875rem; }
  .breadcrumbs, nav[aria-label*="breadcrumb"] { display: flex; gap: 0.5rem; margin-bottom: 1rem; font-size: 0.875rem; color: #555; }
  .pagination, .prev-next { display: flex; justify-content: space-between; margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; }
  .pagination a, .prev-next a { color: #2563eb; }
  input[type="search"], [data-search], button:has-text("Search") { padding: 0.5rem 1rem; border: 1px solid #e5e7eb; border-radius: 0.25rem; width: 100%; margin-bottom: 1rem; }
`

export function docsPageHtml(page: string): string {
  const titles: Record<string, string> = {
    'index': 'Documentation',
    'getting-started': 'Getting Started',
    'api': 'API Reference',
  }
  const title = titles[page] || page.split('/').pop() || 'Documentation'

  const content = `
    <div class="docs-layout">
      <aside class="sidebar docs-nav" data-sidebar role="navigation" aria-label="Documentation navigation">
        <input type="search" placeholder="Search docs..." data-search aria-label="Search documentation">
        <nav>
          <a href="/docs" ${page === 'index' ? 'class="active" aria-current="page"' : ''}>Overview</a>
          <a href="/docs/getting-started" ${page === 'getting-started' ? 'class="active" aria-current="page"' : ''}>Getting Started</a>
          <a href="/docs/api" ${page === 'api' ? 'class="active" aria-current="page"' : ''}>API Reference</a>
          <a href="/docs/concepts">Concepts</a>
          <a href="/docs/guides">Guides</a>
        </nav>
      </aside>

      <main class="docs-main">
        <nav class="breadcrumbs" aria-label="breadcrumb">
          <ol style="display:flex; gap:0.5rem; list-style:none;">
            <li><a href="/docs">Docs</a></li>
            <li>/</li>
            <li aria-current="page">${title}</li>
          </ol>
        </nav>

        <article class="docs-content prose mdx-content">
          <h1>${title}</h1>
          <p>Welcome to the dotdo documentation. Learn how to build stateful serverless applications.</p>

          <h2 id="installation">Installation</h2>
          <p>Install dotdo using npm:</p>
          <pre><code class="code-block" data-rehype-pretty-code>npm install dotdo</code></pre>

          <h2 id="quick-start">Quick Start</h2>
          <p>Create your first Durable Object:</p>
          <pre><code class="code-block" data-rehype-pretty-code>import { DurableObject } from 'dotdo'

export class Counter extends DurableObject {
  async increment() {
    const value = await this.state.storage.get('count') ?? 0
    await this.state.storage.put('count', value + 1)
    return value + 1
  }
}</code></pre>
        </article>

        <aside class="toc table-of-contents" aria-label="Table of contents">
          <h4>On this page</h4>
          <nav>
            <a href="#installation">Installation</a>
            <a href="#quick-start">Quick Start</a>
          </nav>
        </aside>

        <nav class="pagination prev-next" aria-label="Previous and next pages">
          <a href="/docs" class="previous">Previous</a>
          <a href="/docs/getting-started" class="next">Next</a>
        </nav>
      </main>
    </div>
  `
  return layout(`${title} - dotdo Documentation`, content, docsStyles)
}

// Admin styles - enhanced for MDX cockpit dashboard
const adminStyles = `
  .admin-layout { display: flex; min-height: 100vh; }
  .shell, .admin-shell, aside.sidebar { width: 250px; background: #1f2937; color: #fff; padding: 1rem; }
  .shell a { display: block; padding: 0.75rem 1rem; color: #9ca3af; border-radius: 0.5rem; margin-bottom: 0.25rem; }
  .shell a:hover { background: #374151; color: #fff; text-decoration: none; }
  .shell a.active { background: #2563eb; color: #fff; }
  .admin-main { flex: 1; padding: 2rem; background: #0a0a0a; color: #fff; overflow-y: auto; }
  .dashboard, [data-dashboard] { padding: 0; }
  .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .kpi-card, .metric-card, .stat-card { background: #111; padding: 1.5rem; border-radius: 0.75rem; border: 1px solid #333; }
  .kpi-card h3 { font-size: 0.875rem; color: #9ca3af; margin-bottom: 0.5rem; }
  .kpi-card .value { font-size: 2rem; font-weight: bold; }
  table, [data-table], .data-table { width: 100%; background: #111; border-radius: 0.5rem; overflow: hidden; border: 1px solid #333; }
  table th, table td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #333; }
  table th { background: #0a0a0a; font-weight: 600; }
  select, [data-filter] { padding: 0.5rem 1rem; border: 1px solid #333; border-radius: 0.375rem; background: #111; color: #fff; }
  input[type="search"], input[placeholder*="Search"] { padding: 0.5rem 1rem; border: 1px solid #333; border-radius: 0.375rem; width: 100%; max-width: 300px; background: #111; color: #fff; }
  .btn { display: inline-flex; align-items: center; justify-content: center; padding: 0.5rem 1rem; border-radius: 0.375rem; font-weight: 500; border: none; }
  .btn-primary { background: #2563eb; color: #fff; }
  form { background: #111; padding: 1.5rem; border-radius: 0.5rem; border: 1px solid #333; }
  form label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.25rem; color: #9ca3af; }
  form input, form select { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #333; border-radius: 0.375rem; margin-bottom: 1rem; background: #0a0a0a; color: #fff; }
  form input[type="submit"], form button[type="submit"] { background: #2563eb; color: #fff; border: none; cursor: pointer; width: auto; }
  hr { border: none; border-top: 1px solid #333; margin: 2rem 0; }
  h1, h2, h3 { color: #fff; }
  p { color: #9ca3af; }
  [data-component] { color: #fff; }
  .section-box { background: #111; border: 1px solid #333; border-radius: 0.75rem; padding: 1.5rem; margin-bottom: 1rem; }
  .grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.5rem; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; }
  .grid-6 { display: grid; grid-template-columns: repeat(6, 1fr); gap: 1rem; }
  .agent-card { text-align: center; padding: 1rem; background: #111; border: 1px solid #333; border-radius: 0.5rem; }
  .agent-avatar { width: 3rem; height: 3rem; margin: 0 auto 0.5rem; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #8b5cf6); display: flex; align-items: center; justify-content: center; font-weight: bold; }
  .command-item { display: block; width: 100%; text-align: left; padding: 0.75rem 1rem; background: transparent; border: none; color: #fff; cursor: pointer; border-radius: 0.375rem; }
  .command-item:hover { background: #333; }
  .tabs-list { display: flex; gap: 0.5rem; border-bottom: 1px solid #333; padding-bottom: 0.5rem; margin-bottom: 1rem; }
  .tab-trigger { padding: 0.5rem 1rem; background: transparent; border: none; color: #9ca3af; cursor: pointer; border-radius: 0.375rem; }
  .tab-trigger[data-state="active"] { background: #333; color: #fff; }
  .workflow-item { display: flex; justify-content: space-between; padding: 0.75rem; background: #0a0a0a; border-radius: 0.375rem; margin-bottom: 0.5rem; }
  .timeline-item { display: flex; gap: 0.75rem; margin-bottom: 0.75rem; }
  .timeline-dot { width: 0.5rem; height: 0.5rem; background: #3b82f6; border-radius: 50%; margin-top: 0.5rem; }
  .chart-placeholder { height: 12rem; display: flex; align-items: center; justify-content: center; color: #666; background: #0a0a0a; border-radius: 0.375rem; }
  .settings-section { margin-bottom: 1.5rem; }
  .sidebar-nav { display: flex; flex-direction: column; gap: 0.25rem; }
  .nav-item { display: flex; align-items: center; gap: 0.75rem; }
  .sidebar-user { padding-top: 1rem; margin-top: auto; border-top: 1px solid #333; display: flex; align-items: center; gap: 0.75rem; }
`

// SVG Icons for the dashboard (inline)
const icons = {
  Home: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>',
  Rocket: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path></svg>',
  Users: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><path d="M20 8v6"></path><path d="M23 11h-6"></path></svg>',
  GitBranch: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>',
  Activity: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
  Code: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
  BarChart: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"></line><line x1="18" y1="20" x2="18" y2="4"></line><line x1="6" y1="20" x2="6" y2="16"></line></svg>',
  Settings: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>',
}

// Kept for backwards compatibility with other admin pages
const adminShell = (title: string, activeRoute: string, content: string) => `
  <div class="admin-layout">
    <aside class="shell admin-shell sidebar">
      <a href="/admin" style="font-size: 1.25rem; font-weight: bold; color: #fff; margin-bottom: 2rem; display: block;">dotdo Admin</a>
      <nav>
        <a href="/admin" ${activeRoute === 'dashboard' ? 'class="active"' : ''}>Dashboard</a>
        <a href="/admin/users" ${activeRoute === 'users' ? 'class="active"' : ''}>Users</a>
        <a href="/admin/workflows" ${activeRoute === 'workflows' ? 'class="active"' : ''}>Workflows</a>
        <a href="/admin/integrations" ${activeRoute === 'integrations' ? 'class="active"' : ''}>Integrations</a>
        <a href="/admin/activity" ${activeRoute === 'activity' ? 'class="active"' : ''}>Activity</a>
        <a href="/admin/settings" ${activeRoute === 'settings' ? 'class="active"' : ''}>Settings</a>
      </nav>
      <div style="margin-top: auto; padding-top: 2rem;">
        <a href="/" style="color: #9ca3af;">Back to Site</a>
        <button style="display: block; margin-top: 0.5rem; background: transparent; border: none; color: #9ca3af; cursor: pointer;">Logout</button>
        <a href="/admin/login" style="color: #9ca3af;">Sign out</a>
      </div>
    </aside>
    <main class="admin-main">
      <h1 style="font-size: 1.5rem; font-weight: 600; margin-bottom: 1.5rem;">${title}</h1>
      ${content}
    </main>
  </div>
`

/**
 * Admin Dashboard - Renders .do/App.mdx content with @mdxui/cockpit components
 *
 * This server-side rendered page mirrors the MDX structure from .do/App.mdx
 * with all required data attributes for E2E testing.
 */
export function adminDashboardHtml(): string {
  // Data that would be passed to MDX
  const stats = {
    activeAgents: 7,
    agentTrend: '+12%',
    runningWorkflows: 12,
    workflowTrend: '+3',
    eventsToday: 1248,
    eventTrend: '+15%',
  }

  const recentActivity = [
    { id: '1', type: 'agent', title: 'Priya completed product spec', description: 'MVP specification for new feature', timestamp: new Date().toISOString() },
    { id: '2', type: 'workflow', title: 'Deployment workflow completed', description: 'Production deployment successful', timestamp: new Date(Date.now() - 3600000).toISOString() },
    { id: '3', type: 'event', title: 'New customer signup', description: 'Customer.signup event processed', timestamp: new Date(Date.now() - 7200000).toISOString() },
  ]

  const teamAgents = [
    { id: '1', name: 'Priya', status: 'working', role: 'Product' },
    { id: '2', name: 'Ralph', status: 'idle', role: 'Engineering' },
    { id: '3', name: 'Tom', status: 'reviewing', role: 'Tech Lead' },
    { id: '4', name: 'Mark', status: 'writing', role: 'Marketing' },
    { id: '5', name: 'Sally', status: 'outreach', role: 'Sales' },
    { id: '6', name: 'Quinn', status: 'testing', role: 'QA' },
  ]

  const startupColumns = ['Name', 'Status', 'Hypothesis', 'Experiments', 'Metrics']

  const startups = [
    { name: 'MyStartup', status: 'Active', hypothesis: 'PMF for B2B SaaS', experiments: 3, metrics: 'HUNCH: 72%' },
    { name: 'AcmeInc', status: 'Testing', hypothesis: 'Marketplace model', experiments: 5, metrics: 'HUNCH: 58%' },
  ]

  const activeWorkflows = [
    { id: '1', name: 'Customer Onboarding', status: 'running' },
    { id: '2', name: 'Daily Standup', status: 'scheduled' },
    { id: '3', name: 'Code Review', status: 'running' },
  ]

  const workflowEvents = [
    { id: '1', type: 'workflow.started', timestamp: new Date().toISOString() },
    { id: '2', type: 'task.completed', timestamp: new Date(Date.now() - 1800000).toISOString() },
    { id: '3', type: 'agent.assigned', timestamp: new Date(Date.now() - 3600000).toISOString() },
  ]

  const revenueData = [
    { month: 'Jan', revenue: 4000 },
    { month: 'Feb', revenue: 5200 },
    { month: 'Mar', revenue: 6100 },
    { month: 'Apr', revenue: 7800 },
    { month: 'May', revenue: 9200 },
    { month: 'Jun', revenue: 11500 },
  ]

  const agentUsage = [
    { agent: 'Priya', tasks: 45 },
    { agent: 'Ralph', tasks: 128 },
    { agent: 'Tom', tasks: 67 },
    { agent: 'Mark', tasks: 34 },
    { agent: 'Sally', tasks: 89 },
    { agent: 'Quinn', tasks: 56 },
  ]

  const experimentResults = [
    { variant: 'Control', conversion: 3.2 },
    { variant: 'A', conversion: 4.1 },
    { variant: 'B', conversion: 3.8 },
    { variant: 'C', conversion: 5.2 },
  ]

  const content = `
<div data-mdx-source=".do/App.mdx" data-mdxui-cockpit data-mdx-runtime>
  <div data-component="DashboardLayout" class="admin-layout" style="display: flex; min-height: 100vh;">
    <!-- Sidebar -->
    <div data-component="Sidebar" style="width: 250px; background: #111; border-right: 1px solid #333; display: flex; flex-direction: column;">
      <div data-component="SidebarNav" class="sidebar-nav" style="flex: 1; padding: 1rem;">
        <div data-component="NavItem" class="nav-item" style="margin-bottom: 0.25rem;">
          <a href="/admin" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; color: #fff; border-radius: 0.5rem; text-decoration: none;">
            <span data-icon="Home">${icons.Home}</span>
            <span>Overview</span>
          </a>
        </div>
        <div data-component="NavItem" class="nav-item" style="margin-bottom: 0.25rem;">
          <a href="/admin/startups" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; color: #9ca3af; border-radius: 0.5rem; text-decoration: none;">
            <span data-icon="Rocket">${icons.Rocket}</span>
            <span>Startups</span>
          </a>
        </div>
        <div data-component="NavItem" class="nav-item" style="margin-bottom: 0.25rem;">
          <a href="/admin/agents" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; color: #9ca3af; border-radius: 0.5rem; text-decoration: none;">
            <span data-icon="Users">${icons.Users}</span>
            <span>Agents</span>
          </a>
        </div>
        <div data-component="NavItem" class="nav-item" style="margin-bottom: 0.25rem;">
          <a href="/admin/workflows" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; color: #9ca3af; border-radius: 0.5rem; text-decoration: none;">
            <span data-icon="GitBranch">${icons.GitBranch}</span>
            <span>Workflows</span>
          </a>
        </div>
        <div data-component="NavItem" class="nav-item" style="margin-bottom: 0.25rem;">
          <a href="/admin/events" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; color: #9ca3af; border-radius: 0.5rem; text-decoration: none;">
            <span data-icon="Activity">${icons.Activity}</span>
            <span>Events</span>
          </a>
        </div>
        <div data-component="NavItem" class="nav-item" style="margin-bottom: 0.25rem;">
          <a href="/admin/functions" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; color: #9ca3af; border-radius: 0.5rem; text-decoration: none;">
            <span data-icon="Code">${icons.Code}</span>
            <span>Functions</span>
          </a>
        </div>
        <div data-component="NavItem" class="nav-item" style="margin-bottom: 0.25rem;">
          <a href="/admin/analytics" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; color: #9ca3af; border-radius: 0.5rem; text-decoration: none;">
            <span data-icon="BarChart">${icons.BarChart}</span>
            <span>Analytics</span>
          </a>
        </div>
        <div data-component="NavItem" class="nav-item" style="margin-bottom: 0.25rem;">
          <a href="/admin/settings" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; color: #9ca3af; border-radius: 0.5rem; text-decoration: none;">
            <span data-icon="Settings">${icons.Settings}</span>
            <span>Settings</span>
          </a>
        </div>
      </div>
      <div data-component="SidebarUser" class="sidebar-user" style="padding: 1rem; border-top: 1px solid #333;">
        <div style="width: 2rem; height: 2rem; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #8b5cf6); display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.875rem;">U</div>
        <div>
          <div style="font-size: 0.875rem; font-weight: 500;">User</div>
          <div style="font-size: 0.75rem; color: #9ca3af;">user@dotdo.dev</div>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div data-component="DashboardContent" style="flex: 1; padding: 2rem; overflow-y: auto; background: #0a0a0a;">
      <!-- Main Heading from MDX: # dotdo Dashboard -->
      <h1 style="font-size: 2.5rem; font-weight: bold; margin-bottom: 2rem; color: #fff;">dotdo Dashboard</h1>

      <!-- Welcome Section from MDX: ## Welcome to dotdo -->
      <h2 style="font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem; color: #fff;">Welcome to dotdo</h2>
      <p style="color: #9ca3af; margin-bottom: 1.5rem;">Your autonomous business control center.</p>

      <!-- KPI Cards Grid -->
      <div data-component="DashboardGrid" data-cols="3" class="grid-3" style="margin-bottom: 2rem;">
        <div data-component="KPICard" class="section-box">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <span style="font-size: 0.875rem; color: #9ca3af;">Active Agents</span>
            <span data-icon="Users">${icons.Users}</span>
          </div>
          <div data-kpi-value style="font-size: 2rem; font-weight: bold; color: #fff;">${stats.activeAgents}</div>
          <div data-kpi-trend style="font-size: 0.875rem; color: #22c55e; margin-top: 0.5rem;">${stats.agentTrend}</div>
        </div>
        <div data-component="KPICard" class="section-box">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <span style="font-size: 0.875rem; color: #9ca3af;">Workflows Running</span>
            <span data-icon="GitBranch">${icons.GitBranch}</span>
          </div>
          <div data-kpi-value style="font-size: 2rem; font-weight: bold; color: #fff;">${stats.runningWorkflows}</div>
          <div data-kpi-trend style="font-size: 0.875rem; color: #22c55e; margin-top: 0.5rem;">${stats.workflowTrend}</div>
        </div>
        <div data-component="KPICard" class="section-box">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <span style="font-size: 0.875rem; color: #9ca3af;">Events Today</span>
            <span data-icon="Activity">${icons.Activity}</span>
          </div>
          <div data-kpi-value style="font-size: 2rem; font-weight: bold; color: #fff;">${stats.eventsToday}</div>
          <div data-kpi-trend style="font-size: 0.875rem; color: #22c55e; margin-top: 0.5rem;">${stats.eventTrend}</div>
        </div>
      </div>

      <!-- Recent Activity from MDX: ### Recent Activity -->
      <h3 style="font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; color: #fff;">Recent Activity</h3>
      <div data-component="ActivityFeed" data-items-count="${recentActivity.length}" class="section-box" style="margin-bottom: 2rem;">
        ${recentActivity.map(item => `
          <div data-activity-item style="padding: 0.75rem; border-bottom: 1px solid #333;">
            <div style="font-weight: 500; color: #fff;">${item.title}</div>
            <div style="font-size: 0.875rem; color: #9ca3af;">${item.description}</div>
            <div style="font-size: 0.75rem; color: #666; margin-top: 0.25rem;">${new Date(item.timestamp).toLocaleString()}</div>
          </div>
        `).join('')}
      </div>

      <!-- Your Team from MDX: ### Your Team -->
      <h3 style="font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; color: #fff;">Your Team</h3>
      <div data-component="AgentStatus" data-agents-count="${teamAgents.length}" class="section-box" style="margin-bottom: 2rem;">
        <p style="color: #9ca3af; margin-bottom: 1rem;">Monitor your AI agents in real-time. See what Priya, Ralph, Tom, and the team are working on.</p>
        <div class="grid-6">
          ${teamAgents.map(agent => `
            <div style="text-align: center; padding: 1rem; background: #0a0a0a; border-radius: 0.5rem;">
              <div style="width: 2.5rem; height: 2.5rem; margin: 0 auto 0.5rem; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #8b5cf6); display: flex; align-items: center; justify-content: center; font-weight: bold;">${agent.name[0]}</div>
              <div style="font-weight: 500; font-size: 0.875rem; color: #fff;">${agent.name}</div>
              <div style="font-size: 0.75rem; color: #9ca3af;">${agent.status}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Quick Actions from MDX: ### Quick Actions -->
      <h3 style="font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; color: #fff;">Quick Actions</h3>
      <div data-component="CommandPalette" class="section-box" style="margin-bottom: 2rem;">
        <div data-component="CommandGroup" style="margin-bottom: 1rem;">
          <div style="font-size: 0.875rem; font-weight: 600; color: #9ca3af; margin-bottom: 0.5rem; padding: 0 1rem;">Agents</div>
          <button data-component="CommandItem" data-agent="priya" class="command-item">Ask Priya for product direction</button>
          <button data-component="CommandItem" data-agent="ralph" class="command-item">Have Ralph start building</button>
          <button data-component="CommandItem" data-agent="tom" class="command-item">Request code review from Tom</button>
        </div>
        <div data-component="CommandGroup">
          <div style="font-size: 0.875rem; font-weight: 600; color: #9ca3af; margin-bottom: 0.5rem; padding: 0 1rem;">Workflows</div>
          <button data-component="CommandItem" class="command-item">Create new workflow</button>
          <button data-component="CommandItem" class="command-item">View running workflows</button>
          <button data-component="CommandItem" class="command-item">Check event log</button>
        </div>
      </div>

      <hr />

      <!-- Startup Management from MDX: ## Startup Management -->
      <h2 style="font-size: 1.5rem; font-weight: 600; margin-bottom: 1rem; color: #fff;">Startup Management</h2>
      <div data-component="DataTable" class="section-box" style="margin-bottom: 2rem;">
        <p style="color: #9ca3af; margin-bottom: 1rem;">Manage all your startups from one place. Track hypotheses, experiments, and metrics.</p>
        <div data-search style="margin-bottom: 1rem;">
          <input type="search" placeholder="Search..." style="width: 100%; max-width: 300px; padding: 0.5rem 1rem; background: #0a0a0a; border: 1px solid #333; border-radius: 0.375rem; color: #fff;" />
        </div>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="border-bottom: 1px solid #333;">
              ${startupColumns.map(col => `<th data-sortable style="padding: 0.75rem 1rem; text-align: left; font-weight: 600; color: #9ca3af;">${col}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${startups.map(startup => `
              <tr style="border-bottom: 1px solid #333;">
                <td style="padding: 0.75rem 1rem; color: #fff;">${startup.name}</td>
                <td style="padding: 0.75rem 1rem; color: #fff;">${startup.status}</td>
                <td style="padding: 0.75rem 1rem; color: #fff;">${startup.hypothesis}</td>
                <td style="padding: 0.75rem 1rem; color: #fff;">${startup.experiments}</td>
                <td style="padding: 0.75rem 1rem; color: #fff;">${startup.metrics}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div data-pagination style="display: flex; justify-content: space-between; align-items: center; margin-top: 1rem; padding: 0.5rem 0;">
          <span style="font-size: 0.875rem; color: #9ca3af;">Showing ${startups.length} results</span>
          <div style="display: flex; gap: 0.5rem;">
            <button style="padding: 0.25rem 0.75rem; background: #333; border: none; border-radius: 0.25rem; color: #fff; cursor: pointer;">Previous</button>
            <button style="padding: 0.25rem 0.75rem; background: #333; border: none; border-radius: 0.25rem; color: #fff; cursor: pointer;">Next</button>
          </div>
        </div>
      </div>

      <hr />

      <!-- Agent Configuration from MDX: ## Agent Configuration -->
      <h2 style="font-size: 1.5rem; font-weight: 600; margin-bottom: 1rem; color: #fff;">Agent Configuration</h2>
      <div data-component="Tabs" class="section-box" style="margin-bottom: 2rem;">
        <div data-component="TabsList" class="tabs-list">
          <button data-component="TabsTrigger" data-state="active" class="tab-trigger">Active Agents</button>
          <button data-component="TabsTrigger" data-state="inactive" class="tab-trigger">Available</button>
          <button data-component="TabsTrigger" data-state="inactive" class="tab-trigger">Custom</button>
        </div>
        <div data-component="TabsContent" data-value="active">
          <div data-component="AgentGrid" class="grid-6">
            <div data-component="AgentCard" data-status="working" class="agent-card">
              <div class="agent-avatar">P</div>
              <div style="font-weight: 500; font-size: 0.875rem; color: #fff;">Priya</div>
              <div style="font-size: 0.75rem; color: #9ca3af;">Product</div>
              <div style="margin-top: 0.5rem;"><span style="padding: 0.125rem 0.5rem; font-size: 0.75rem; background: #166534; color: #22c55e; border-radius: 9999px;">working</span></div>
            </div>
            <div data-component="AgentCard" data-status="idle" class="agent-card">
              <div class="agent-avatar">R</div>
              <div style="font-weight: 500; font-size: 0.875rem; color: #fff;">Ralph</div>
              <div style="font-size: 0.75rem; color: #9ca3af;">Engineering</div>
              <div style="margin-top: 0.5rem;"><span style="padding: 0.125rem 0.5rem; font-size: 0.75rem; background: #333; color: #9ca3af; border-radius: 9999px;">idle</span></div>
            </div>
            <div data-component="AgentCard" data-status="reviewing" class="agent-card">
              <div class="agent-avatar">T</div>
              <div style="font-weight: 500; font-size: 0.875rem; color: #fff;">Tom</div>
              <div style="font-size: 0.75rem; color: #9ca3af;">Tech Lead</div>
              <div style="margin-top: 0.5rem;"><span style="padding: 0.125rem 0.5rem; font-size: 0.75rem; background: #1e3a5f; color: #3b82f6; border-radius: 9999px;">reviewing</span></div>
            </div>
            <div data-component="AgentCard" data-status="writing" class="agent-card">
              <div class="agent-avatar">M</div>
              <div style="font-weight: 500; font-size: 0.875rem; color: #fff;">Mark</div>
              <div style="font-size: 0.75rem; color: #9ca3af;">Marketing</div>
              <div style="margin-top: 0.5rem;"><span style="padding: 0.125rem 0.5rem; font-size: 0.75rem; background: #422006; color: #f97316; border-radius: 9999px;">writing</span></div>
            </div>
            <div data-component="AgentCard" data-status="outreach" class="agent-card">
              <div class="agent-avatar">S</div>
              <div style="font-weight: 500; font-size: 0.875rem; color: #fff;">Sally</div>
              <div style="font-size: 0.75rem; color: #9ca3af;">Sales</div>
              <div style="margin-top: 0.5rem;"><span style="padding: 0.125rem 0.5rem; font-size: 0.75rem; background: #4c1d95; color: #a78bfa; border-radius: 9999px;">outreach</span></div>
            </div>
            <div data-component="AgentCard" data-status="testing" class="agent-card">
              <div class="agent-avatar">Q</div>
              <div style="font-weight: 500; font-size: 0.875rem; color: #fff;">Quinn</div>
              <div style="font-size: 0.75rem; color: #9ca3af;">QA</div>
              <div style="margin-top: 0.5rem;"><span style="padding: 0.125rem 0.5rem; font-size: 0.75rem; background: #164e63; color: #22d3d1; border-radius: 9999px;">testing</span></div>
            </div>
          </div>
        </div>
        <div data-component="TabsContent" data-value="available" style="display: none;">
          <p style="color: #9ca3af; padding: 1rem;">Additional agents available from agents.do</p>
        </div>
        <div data-component="TabsContent" data-value="custom" style="display: none;">
          <p style="color: #9ca3af; padding: 1rem;">Create custom agents for your specific domain</p>
        </div>
      </div>

      <hr />

      <!-- Workflow Monitor from MDX: ## Workflow Monitor -->
      <h2 style="font-size: 1.5rem; font-weight: 600; margin-bottom: 1rem; color: #fff;">Workflow Monitor</h2>
      <div data-component="WorkflowDashboard" class="grid-2" style="margin-bottom: 2rem;">
        <div data-component="WorkflowList" data-workflows-count="${activeWorkflows.length}" class="section-box">
          <h4 style="font-weight: 600; margin-bottom: 1rem; color: #fff;">Active Workflows</h4>
          ${activeWorkflows.map(wf => `
            <div class="workflow-item">
              <span style="color: #fff;">${wf.name}</span>
              <span style="font-size: 0.75rem; color: #9ca3af;">${wf.status}</span>
            </div>
          `).join('')}
        </div>
        <div data-component="WorkflowTimeline" data-events-count="${workflowEvents.length}" class="section-box">
          <h4 style="font-weight: 600; margin-bottom: 1rem; color: #fff;">Timeline</h4>
          ${workflowEvents.map(event => `
            <div class="timeline-item">
              <div class="timeline-dot"></div>
              <div>
                <div style="font-size: 0.875rem; color: #fff;">${event.type}</div>
                <div style="font-size: 0.75rem; color: #9ca3af;">${new Date(event.timestamp).toLocaleString()}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <hr />

      <!-- Analytics from MDX: ## Analytics -->
      <h2 style="font-size: 1.5rem; font-weight: 600; margin-bottom: 1rem; color: #fff;">Analytics</h2>
      <div data-component="AnalyticsDashboard" class="grid-3" style="margin-bottom: 2rem;">
        <div data-component="AreaChart" data-data-count="${revenueData.length}" class="section-box">
          <h4 style="font-weight: 600; color: #fff;">Revenue</h4>
          <p style="font-size: 0.875rem; color: #9ca3af; margin-bottom: 1rem;">Monthly recurring revenue over time</p>
          <div class="chart-placeholder">[Area Chart - ${revenueData.length} data points]</div>
        </div>
        <div data-component="BarChart" data-data-count="${agentUsage.length}" class="section-box">
          <h4 style="font-weight: 600; color: #fff;">Agent Usage</h4>
          <p style="font-size: 0.875rem; color: #9ca3af; margin-bottom: 1rem;">Tasks completed by each agent</p>
          <div class="chart-placeholder">[Bar Chart - ${agentUsage.length} data points]</div>
        </div>
        <div data-component="LineChart" data-data-count="${experimentResults.length}" class="section-box">
          <h4 style="font-weight: 600; color: #fff;">Experiment Results</h4>
          <p style="font-size: 0.875rem; color: #9ca3af; margin-bottom: 1rem;">Conversion rates across variants</p>
          <div class="chart-placeholder">[Line Chart - ${experimentResults.length} data points]</div>
        </div>
      </div>

      <hr />

      <!-- Settings from MDX: ## Settings -->
      <h2 style="font-size: 1.5rem; font-weight: 600; margin-bottom: 1rem; color: #fff;">Settings</h2>
      <div data-component="SettingsLayout">
        <div data-component="SettingsSection" class="section-box settings-section">
          <h4 style="font-weight: 600; margin-bottom: 1rem; color: #fff;">Profile</h4>
          <div data-component="UserProfile">
            <div style="display: flex; align-items: center; gap: 1rem;">
              <div style="width: 4rem; height: 4rem; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #8b5cf6); display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: bold;">U</div>
              <div>
                <div style="font-weight: 600; color: #fff;">User Name</div>
                <div style="font-size: 0.875rem; color: #9ca3af;">user@dotdo.dev</div>
              </div>
            </div>
          </div>
        </div>
        <div data-component="SettingsSection" class="section-box settings-section">
          <h4 style="font-weight: 600; margin-bottom: 1rem; color: #fff;">API Keys</h4>
          <div data-component="APIKeyManager">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: #9ca3af;">No API keys configured</span>
              <button style="padding: 0.5rem 1rem; background: #2563eb; color: #fff; border: none; border-radius: 0.375rem; cursor: pointer;">Create Key</button>
            </div>
          </div>
        </div>
        <div data-component="SettingsSection" class="section-box settings-section">
          <h4 style="font-weight: 600; margin-bottom: 1rem; color: #fff;">Integrations</h4>
          <div data-component="IntegrationsList">
            <p style="color: #9ca3af; text-align: center; padding: 1rem;">No integrations configured</p>
          </div>
        </div>
        <div data-component="SettingsSection" class="section-box settings-section">
          <h4 style="font-weight: 600; margin-bottom: 1rem; color: #fff;">Billing</h4>
          <div data-component="BillingManager">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-weight: 600; color: #fff;">Free Plan</div>
                <div style="font-size: 0.875rem; color: #9ca3af;">Upgrade for more features</div>
              </div>
              <button style="padding: 0.5rem 1rem; background: #333; color: #fff; border: none; border-radius: 0.375rem; cursor: pointer;">Upgrade</button>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</div>

<!-- Tab switching script -->
<script>
  document.querySelectorAll('[data-component="TabsTrigger"]').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const tabs = trigger.closest('[data-component="Tabs"]');
      const triggers = tabs.querySelectorAll('[data-component="TabsTrigger"]');
      const contents = tabs.querySelectorAll('[data-component="TabsContent"]');

      triggers.forEach(t => t.setAttribute('data-state', 'inactive'));
      trigger.setAttribute('data-state', 'active');

      const value = trigger.textContent.toLowerCase().split(' ')[0];
      contents.forEach(content => {
        content.style.display = content.dataset.value === value ? 'block' : 'none';
      });
    });
  });

  // Agent command click handlers
  document.querySelectorAll('[data-component="CommandItem"][data-agent]').forEach(item => {
    item.addEventListener('click', () => {
      const agent = item.dataset.agent;
      const modal = document.createElement('div');
      modal.setAttribute('data-agent-chat', agent);
      modal.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 50;';
      modal.innerHTML = \`
        <div style="background: #111; border: 1px solid #333; border-radius: 0.5rem; padding: 1.5rem; max-width: 28rem; width: 100%; margin: 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <h3 style="font-weight: 600; color: #fff;">Chat with \${agent}</h3>
            <button onclick="this.closest('[data-agent-chat]').remove()" style="background: transparent; border: none; color: #9ca3af; cursor: pointer; font-size: 1.25rem;">X</button>
          </div>
          <p style="color: #9ca3af;">Starting conversation with \${agent}...</p>
        </div>
      \`;
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
      document.body.appendChild(modal);
    });
  });
</script>
`

  return layout('dotdo Dashboard', content, adminStyles)
}

// Login page styles
const loginStyles = `
  .login-container { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f9fafb; }
  .login-box { background: #fff; padding: 2rem; border-radius: 0.75rem; box-shadow: 0 4px 6px rgba(0,0,0,0.1); width: 100%; max-width: 400px; }
  .login-box h1 { font-size: 1.5rem; text-align: center; margin-bottom: 0.5rem; }
  .login-box p { text-align: center; color: #6b7280; margin-bottom: 1.5rem; }
  .login-box form { margin-bottom: 1.5rem; }
  .login-box label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.25rem; }
  .login-box input { width: 100%; padding: 0.75rem; border: 1px solid #d1d5db; border-radius: 0.375rem; margin-bottom: 1rem; }
  .login-box button[type="submit"] { width: 100%; padding: 0.75rem; background: #2563eb; color: #fff; border: none; border-radius: 0.375rem; font-weight: 500; cursor: pointer; }
  .login-box button[type="submit"]:hover { background: #1d4ed8; }
  .oauth-buttons { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem; }
  .oauth-btn { display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.75rem; border: 1px solid #d1d5db; border-radius: 0.375rem; background: #fff; cursor: pointer; }
  .oauth-btn:hover { background: #f9fafb; }
  .divider { display: flex; align-items: center; gap: 1rem; margin: 1.5rem 0; }
  .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: #e5e7eb; }
  .divider span { color: #9ca3af; font-size: 0.875rem; }
  .forgot-link { display: block; text-align: center; color: #2563eb; font-size: 0.875rem; margin-top: 1rem; }
  .error, [role="alert"], .validation-error { color: #dc2626; font-size: 0.875rem; margin-top: 0.25rem; }
`

export function adminLoginHtml(): string {
  const content = `
    <div class="login-container">
      <div class="login-box">
        <h1>Admin Login</h1>
        <p>Sign in to access the admin dashboard</p>

        <div class="oauth-buttons">
          <button type="button" class="oauth-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Sign in with Google
          </button>
          <button type="button" class="oauth-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            Sign in with GitHub
          </button>
          <button type="button" class="oauth-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M0 0h11.377v11.372H0zm12.623 0H24v11.372H12.623zM0 12.623h11.377V24H0zm12.623 0H24V24H12.623z"/></svg>
            Sign in with Microsoft
          </button>
        </div>

        <div class="divider"><span>or</span></div>

        <form method="POST" action="/admin/login">
          <label for="email">Email</label>
          <input type="email" id="email" name="email" required placeholder="you@example.com">

          <label for="password">Password</label>
          <input type="password" id="password" name="password" required placeholder="••••••••">

          <button type="submit">Sign In</button>
        </form>

        <a href="/admin/forgot-password" class="forgot-link">Forgot your password?</a>
      </div>
    </div>
  `
  return layout('Login - dotdo Admin', content, loginStyles)
}

export function adminUsersHtml(): string {
  const content = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
      <div>
        <input type="search" placeholder="Search users..." style="width: 300px;">
      </div>
      <a href="/admin/users/new" class="btn btn-primary">Create User</a>
    </div>
    <table class="data-table" data-table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Role</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>John Doe</td>
          <td>john@example.com</td>
          <td>Admin</td>
          <td><span style="color: #059669;">Active</span></td>
          <td><a href="/admin/users/user-1">Edit</a></td>
        </tr>
        <tr>
          <td>Jane Smith</td>
          <td>jane@example.com</td>
          <td>User</td>
          <td><span style="color: #059669;">Active</span></td>
          <td><a href="/admin/users/user-2">Edit</a></td>
        </tr>
      </tbody>
    </table>
  `
  return layout('Users - dotdo Admin', adminShell('Users', 'users', content), adminStyles)
}

export function adminUserNewHtml(): string {
  const content = `
    <form method="POST" action="/admin/users" style="max-width: 500px;">
      <label for="name">Name</label>
      <input type="text" id="name" name="name" required placeholder="Full name">

      <label for="email">Email</label>
      <input type="email" id="email" name="email" required placeholder="user@example.com">

      <label for="role">Role</label>
      <select id="role" name="role">
        <option value="user">User</option>
        <option value="admin">Admin</option>
      </select>

      <div style="display: flex; gap: 1rem; margin-top: 1rem;">
        <button type="submit" class="btn btn-primary">Create User</button>
        <a href="/admin/users" class="btn" style="border: 1px solid #d1d5db;">Cancel</a>
      </div>
    </form>
  `
  return layout('Create User - dotdo Admin', adminShell('Create User', 'users', content), adminStyles)
}

export function adminWorkflowsHtml(): string {
  const content = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
      <div style="display: flex; gap: 1rem;">
        <select data-filter="status">
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="failed">Failed</option>
        </select>
        <input type="search" placeholder="Search workflows...">
      </div>
    </div>
    <table class="data-table" data-table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Status</th>
          <th>Last Run</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Data Sync Workflow</td>
          <td><span style="color: #059669;">Active</span></td>
          <td>2 hours ago</td>
          <td><a href="/admin/workflows/workflow-1">View</a></td>
        </tr>
        <tr>
          <td>Email Notification</td>
          <td><span style="color: #d97706;">Paused</span></td>
          <td>1 day ago</td>
          <td><a href="/admin/workflows/workflow-2">View</a></td>
        </tr>
        <tr>
          <td>Backup Job</td>
          <td><span style="color: #dc2626;">Failed</span></td>
          <td>3 hours ago</td>
          <td><a href="/admin/workflows/workflow-3">View</a></td>
        </tr>
      </tbody>
    </table>
  `
  return layout('Workflows - dotdo Admin', adminShell('Workflows', 'workflows', content), adminStyles)
}

export function adminIntegrationsHtml(): string {
  const content = `
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem;">
      <div style="background: #fff; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h3 style="font-size: 1.125rem; font-weight: 600;">GitHub</h3>
          <span style="color: #059669;">Connected</span>
        </div>
        <a href="/admin/integrations/github" class="btn" style="border: 1px solid #d1d5db;">Configure</a>
      </div>
      <div style="background: #fff; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h3 style="font-size: 1.125rem; font-weight: 600;">Google</h3>
          <span style="color: #6b7280;">Disconnected</span>
        </div>
        <button class="btn btn-primary">Connect</button>
      </div>
      <div style="background: #fff; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h3 style="font-size: 1.125rem; font-weight: 600;">Slack</h3>
          <span style="color: #6b7280;">Disconnected</span>
        </div>
        <button class="btn btn-primary">Connect</button>
      </div>
    </div>
  `
  return layout('Integrations - dotdo Admin', adminShell('Integrations', 'integrations', content), adminStyles)
}

export function adminApiKeysHtml(): string {
  const content = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
      <p style="color: #6b7280;">Manage your API keys for programmatic access.</p>
      <button class="btn btn-primary">Create API Key</button>
    </div>
    <table class="data-table" data-table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Key</th>
          <th>Created</th>
          <th>Last Used</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Production</td>
          <td><code>sk_live_****abcd</code></td>
          <td>Jan 1, 2024</td>
          <td>2 hours ago</td>
          <td><button style="color: #dc2626; background: transparent; border: none; cursor: pointer;">Revoke</button></td>
        </tr>
      </tbody>
    </table>
  `
  return layout('API Keys - dotdo Admin', adminShell('API Keys', 'integrations', content), adminStyles)
}

export function adminSettingsHtml(): string {
  const content = `
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem;">
      <a href="/admin/settings/account" style="background: #fff; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-decoration: none; color: inherit;">
        <h3 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem;">Account & Profile</h3>
        <p style="color: #6b7280;">Manage your personal information and preferences.</p>
      </a>
      <a href="/admin/settings/security" style="background: #fff; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-decoration: none; color: inherit;">
        <h3 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem;">Security & Password</h3>
        <p style="color: #6b7280;">Update password, Two-Factor authentication (2FA), and sessions.</p>
      </a>
      <div style="background: #fff; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <h3 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem;">Notification Preferences</h3>
        <p style="color: #6b7280;">Configure Email alerts and notifications.</p>
      </div>
    </div>
  `
  return layout('Settings - dotdo Admin', adminShell('Settings', 'settings', content), adminStyles)
}

export function adminSettingsAccountHtml(): string {
  const content = `
    <form method="POST" action="/admin/settings/account" style="max-width: 500px;">
      <label for="name">Name</label>
      <input type="text" id="name" name="name" value="John Doe">

      <label for="email">Email</label>
      <input type="email" id="email" name="email" value="john@example.com" readonly style="background: #f9fafb;">

      <button type="submit" class="btn btn-primary">Save Changes</button>
    </form>
  `
  return layout('Account Settings - dotdo Admin', adminShell('Account Settings', 'settings', content), adminStyles)
}

export function adminSettingsSecurityHtml(): string {
  const content = `
    <div style="max-width: 500px;">
      <form method="POST" action="/admin/settings/security" style="margin-bottom: 2rem;">
        <h3 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 1rem;">Change Password</h3>

        <label for="current-password">Current Password</label>
        <input type="password" id="current-password" name="currentPassword">

        <label for="new-password">New Password</label>
        <input type="password" id="new-password" name="newPassword">

        <label for="confirm-password">Confirm New Password</label>
        <input type="password" id="confirm-password" name="confirmPassword">

        <button type="submit" class="btn btn-primary">Update Password</button>
      </form>

      <div style="background: #fff; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <h3 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 1rem;">Two-Factor Authentication</h3>
        <p style="color: #6b7280; margin-bottom: 1rem;">Add an extra layer of security to your account.</p>
        <button class="btn btn-primary">Enable 2FA</button>
      </div>
    </div>
  `
  return layout('Security Settings - dotdo Admin', adminShell('Security Settings', 'settings', content), adminStyles)
}

export function adminActivityHtml(): string {
  const content = `
    <div style="margin-bottom: 1.5rem;">
      <input type="search" placeholder="Search activity logs...">
    </div>
    <table class="data-table" data-table>
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>User</th>
          <th>Action</th>
          <th>Resource</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>2024-01-08 10:30:00</td>
          <td>John Doe</td>
          <td><span style="background: #dcfce7; color: #166534; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.875rem;">Create</span></td>
          <td>Workflow</td>
        </tr>
        <tr>
          <td>2024-01-08 09:15:00</td>
          <td>Jane Smith</td>
          <td><span style="background: #dbeafe; color: #1e40af; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.875rem;">Update</span></td>
          <td>Integration</td>
        </tr>
        <tr>
          <td>2024-01-08 08:00:00</td>
          <td>John Doe</td>
          <td><span style="background: #f3e8ff; color: #7c3aed; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.875rem;">Login</span></td>
          <td>Session</td>
        </tr>
      </tbody>
    </table>
  `
  return layout('Activity - dotdo Admin', adminShell('Activity', 'activity', content), adminStyles)
}

// 404 page styles
const notFoundStyles = `
  .not-found { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 2rem; }
  .not-found h1 { font-size: 6rem; font-weight: bold; color: #d1d5db; margin-bottom: 1rem; }
  .not-found h2 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  .not-found p { color: #6b7280; margin-bottom: 2rem; }
  .not-found a { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1.5rem; background: #2563eb; color: #fff; border-radius: 0.5rem; }
`

export function notFoundHtml(): string {
  const content = `
    <div class="not-found">
      <h1>404</h1>
      <h2>Page Not Found</h2>
      <p>The page you're looking for doesn't exist or has been moved.</p>
      <a href="/">
        <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
        Back to Home
      </a>
    </div>
  `
  return layout('Page Not Found - dotdo', content, notFoundStyles)
}
