# MDX Marketing Site

A complete marketing landing page using just `Site.mdx`. Zero configuration required.

## Quick Start

```bash
# Navigate to this directory
cd examples/do-start/02-mdx-marketing-site

# Start the dev server (zero config!)
do start
```

Your marketing site is live at `http://localhost:4000`.

## What This Demonstrates

1. **Zero-config MDX** - Just a `Site.mdx` file, no configuration needed
2. **Content-first approach** - Write marketing copy in MDX with embedded components
3. **Inline components** - Define Hero, Features, Pricing components right in MDX
4. **Root routing** - Site.mdx serves at `/` by default

## Project Structure

```
02-mdx-marketing-site/
  Site.mdx          # Your entire marketing site
  README.md         # This file
```

## How It Works

When you run `do start`:

1. The CLI discovers `Site.mdx` in the current directory
2. Since it's a "Site" surface, it serves at the root `/`
3. MDX is compiled with React components support
4. Your marketing page is ready to go

## Key Patterns

### MDX with Frontmatter

```mdx
---
title: "Acme Inc - Ship Faster with AI"
description: "Build your 1-Person Unicorn"
---
```

### Inline Component Definitions

```mdx
export const Hero = ({ headline, cta }) => (
  <section>
    <h1>{headline}</h1>
    <a href={cta.href}>{cta.text}</a>
  </section>
)

<Hero headline="Ship 10x Faster" cta={{ text: "Get Started", href: "/app" }} />
```

### Styling Options

This example uses inline styles for simplicity. In production, consider:
- Tailwind CSS
- CSS Modules
- Styled Components
- MDXUI component library

## Extending This Example

### Add an App Surface

Create `App.tsx` to add a dashboard:

```tsx
export default function App() {
  return <div>Dashboard coming soon</div>
}
```

Now `/` shows Site.mdx and `/app` shows App.tsx.

### Add Configuration

Create `do.config.ts` for custom settings:

```typescript
import { defineConfig } from 'dotdo'

export default defineConfig({
  name: 'acme-marketing',
  port: 3000,
})
```

### Add a Blog

Create `Blog.mdx` and a `blog/` folder:

```
02-mdx-marketing-site/
  Site.mdx
  Blog.mdx           # Blog shell/layout
  blog/
    2024-01-15-launch.mdx
    2024-01-20-features.mdx
```

## Next Steps

- See `03-multi-surface` for App + Admin + Docs + Blog
- See `04-config-with-surfaces` for explicit configuration
- See the [Multi-Surface Architecture](/docs/cli/surfaces) documentation
