#!/usr/bin/env npx tsx
/**
 * Seed runner script.
 *
 * Usage:
 *   npm run db:seed              # Run all seeds
 *   npm run db:seed:integrations # Run only integrations seed
 *
 * This script requires a database connection. In development, it uses
 * better-sqlite3 for local SQLite. In production, you would connect
 * to your D1 database.
 *
 * @module db/seeds/run
 */

import { seedIntegrations } from './index'

async function main() {
  const args = process.argv.slice(2)
  const seedName = args[0]

  console.log('====================================')
  console.log('Database Seed Runner')
  console.log('====================================')
  console.log('')

  // For now, we just export the data that would be seeded
  // The actual seeding requires a database connection which
  // depends on the deployment environment (D1, local SQLite, etc.)

  if (!seedName || seedName === 'integrations') {
    console.log('Integrations Seed Data')
    console.log('----------------------')
    console.log('')
    console.log('This seed will create the following providers:')
    console.log('')

    const { providerDefinitions, PROVIDER_IDS, ACCOUNT_TYPE_IDS } = await import('./integrations')

    for (const provider of providerDefinitions) {
      console.log(`  - ${provider.name} (${provider.id})`)
      console.log(`    Type: ${provider.type}`)
      console.log(`    Category: ${provider.category}`)
      if (provider.oauthConfig) {
        console.log(`    OAuth: ${provider.oauthConfig.scopes.length} scopes`)
      }
      if (provider.webhookConfig) {
        console.log(`    Webhooks: ${provider.webhookConfig.algorithm}`)
      }
      if (provider.actions) {
        console.log(`    Actions: ${provider.actions.length}`)
      }
      console.log('')
    }

    console.log('Account Types:')
    console.log('')
    for (const [key, value] of Object.entries(ACCOUNT_TYPE_IDS)) {
      console.log(`  - ${key}: ${value}`)
    }
    console.log('')

    console.log('Required Environment Variables:')
    console.log('-------------------------------')
    console.log(`
# GitHub
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_WEBHOOK_SECRET=your_github_webhook_secret

# Slack
SLACK_CLIENT_ID=your_slack_client_id
SLACK_CLIENT_SECRET=your_slack_client_secret
SLACK_SIGNING_SECRET=your_slack_signing_secret

# Anthropic
ANTHROPIC_API_KEY=your_anthropic_api_key

# OpenAI
OPENAI_API_KEY=your_openai_api_key

# OpenRouter
OPENROUTER_API_KEY=your_openrouter_api_key

# Stripe
STRIPE_API_KEY=your_stripe_api_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret

# Google
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Notion
NOTION_CLIENT_ID=your_notion_client_id
NOTION_CLIENT_SECRET=your_notion_client_secret

# Linear
LINEAR_CLIENT_ID=your_linear_client_id
LINEAR_CLIENT_SECRET=your_linear_client_secret
LINEAR_WEBHOOK_SECRET=your_linear_webhook_secret

# Discord
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
DISCORD_BOT_TOKEN=your_discord_bot_token

# WorkOS
WORKOS_CLIENT_ID=your_workos_client_id
WORKOS_API_KEY=your_workos_api_key
`)
  }

  console.log('====================================')
  console.log('To run the seed with a database:')
  console.log('')
  console.log('  import { seed } from "./db/seeds/integrations"')
  console.log('  import { drizzle } from "drizzle-orm/d1"')
  console.log('')
  console.log('  const db = drizzle(env.DB)')
  console.log('  await seed(db)')
  console.log('====================================')
}

main().catch(console.error)
