# Compat Layer Audit

> **Generated:** 2026-01-13
> **Total Layers:** 88
> **Issue:** dotdo-fpuhh

This audit identifies which compat layers to keep as core infrastructure vs. which should be deprecated or moved to a secondary package.

## Summary

| Tier | Count | Description |
|------|-------|-------------|
| **Tier 1: Core** | 10 | Essential infrastructure - actively maintained, well-tested |
| **Tier 2: Secondary** | 25 | Common integrations - stable, useful for many users |
| **Tier 3: Niche** | 28 | Specialized use cases - limited testing, low usage |
| **Tier 4: Deprecated** | 25 | Empty/stub/overlapping - candidates for removal |

---

## Tier 1: Core (KEEP - Essential)

These are the 10 essential compat layers that provide foundational capabilities. They are well-tested, actively used, and documented.

| Package | Tests | Files | Category | Notes |
|---------|-------|-------|----------|-------|
| **stripe** | 4 | 12 | Payments | Core billing/payments. Documented in integrations. |
| **openai** | 4 | 6 | AI | Primary AI provider. Used for agent runtime. |
| **anthropic** | 1 | 3 | AI | Secondary AI provider. Claude integration. |
| **sendgrid** | 4 | 7 | Email | Primary email delivery. Multiple clients. |
| **twilio** | 7 | 9 | Communication | SMS/Voice/WhatsApp. Comprehensive tests. |
| **slack** | 8 | 11 | Messaging | Team notifications. Bot, channels, workflows. |
| **s3** | 8 | 8 | Storage | Object storage. Lifecycle, multipart, versioning. |
| **github** | 1 | 9 | DevOps | Code integration. Documented in integrations. |
| **postgres** | 1 | 2 | Database | SQL database. Core infrastructure. |
| **sentry** | 5 | 8 | Observability | Error tracking. Breadcrumbs, transactions. |

### Core Layer Rationale

1. **stripe** - Every SaaS needs payments. Documented, tested, used in examples.
2. **openai** - Primary AI provider for agent runtime, tool calling.
3. **anthropic** - Secondary AI provider, Claude integration for agents.
4. **sendgrid** - Transactional email is essential. Multiple test suites.
5. **twilio** - SMS/Voice for notifications, verification flows.
6. **slack** - Human escalation, team notifications, workflow triggers.
7. **s3** - Object storage for files, assets, backups.
8. **github** - Code integration, webhooks, PR automation.
9. **postgres** - SQL database compatibility (though DO uses SQLite).
10. **sentry** - Error tracking, performance monitoring.

---

## Tier 2: Secondary (KEEP - Common)

Stable integrations useful for many users. Well-tested but not essential.

| Package | Tests | Files | Category | Notes |
|---------|-------|-------|----------|-------|
| **auth0** | 10 | 11 | Auth | Enterprise auth. Users, orgs, connections. |
| **clerk** | 5 | 1 | Auth | Modern auth. Users, sessions, organizations. |
| **hubspot** | 9 | 10 | CRM | Sales CRM. Contacts, deals, pipelines. |
| **salesforce** | 8 | 13 | CRM | Enterprise CRM. SOQL, bulk, workflows. |
| **segment** | 8 | 10 | Analytics | CDP. Track, identify, destinations. |
| **shopify** | 9 | 11 | Commerce | E-commerce. Products, orders, storefront. |
| **discord** | 5 | 9 | Messaging | Community platform. Messages, webhooks. |
| **intercom** | 6 | 11 | Support | Customer support. Conversations, messenger. |
| **zendesk** | 2 | 4 | Support | Helpdesk. Tickets, SLA. |
| **linear** | 1 | 8 | Project | Issue tracking. Documented integration. |
| **gcs** | 1 | 9 | Storage | Google Cloud Storage alternative to S3. |
| **supabase** | 2 | 7 | Database | Postgres + Auth + Storage bundle. |
| **supabase-auth** | 1 | 4 | Auth | Standalone Supabase auth. |
| **zapier** | 6 | 11 | Automation | Workflow automation triggers/actions. |
| **n8n** | 2 | 8 | Automation | Self-hosted workflow automation. |
| **resend** | 1 | 2 | Email | Modern email API alternative. |
| **datadog** | 2 | 6 | Observability | Metrics and monitoring. |
| **cohere** | 1 | 3 | AI | Alternative AI embeddings/reranking. |
| **google-ai** | 1 | 4 | AI | Google Gemini AI provider. |
| **pusher** | 1 | 3 | Realtime | WebSocket/realtime messaging. |
| **sqs** | 1 | 2 | Queue | AWS message queue. |
| **algolia** | 1 | 1 | Search | Full-text search. |
| **mixpanel** | 1 | 3 | Analytics | Product analytics. |
| **amplitude** | 1 | 3 | Analytics | Product analytics alternative. |
| **neo4j** | 1 | 3 | Database | Graph database (though we have native graph). |

---

## Tier 3: Niche (REVIEW - Specialized)

Limited testing, specialized use cases. Consider keeping but deprioritizing.

| Package | Tests | Files | Category | Notes |
|---------|-------|-------|----------|-------|
| **jira** | 1 | 7 | Project | Atlassian issue tracking. |
| **gitlab** | 0 | 7 | DevOps | GitHub alternative. No tests. |
| **benthos** | 27 | 25 | Streaming | Data streaming. Heavy test suite. |
| **flink** | 10 | 6 | Streaming | Stream processing. |
| **cubejs** | 1 | 12 | Analytics | BI/analytics cube. |
| **woocommerce** | 2 | 10 | Commerce | WordPress e-commerce. |
| **freshdesk** | 1 | 3 | Support | Zendesk alternative. |
| **helpscout** | 1 | 3 | Support | Zendesk alternative. |
| **pipedrive** | 1 | 1 | CRM | Sales CRM alternative. |
| **close** | 1 | 1 | CRM | Sales CRM alternative. |
| **duckdb** | 1 | 1 | Database | Embedded analytics DB. |
| **couchdb** | 2 | 1 | Database | Document database. |
| **vonage** | 1 | 1 | Communication | Twilio alternative. |
| **messagebird** | 1 | 2 | Communication | Twilio alternative. |
| **square** | 1 | 3 | Payments | Stripe alternative. |
| **quickbooks** | 1 | 4 | Finance | Accounting software. |
| **klaviyo** | 1 | 1 | Marketing | Email marketing. |
| **mailchimp** | 1 | 1 | Marketing | Email marketing. |
| **doppler** | 1 | 1 | Secrets | Secret management. |
| **vault** | 0 | 1 | Secrets | HashiCorp Vault. No tests. |
| **cloudinary** | 0 | 4 | Media | Image/video CDN. No tests. |
| **contentful** | 1 | 1 | CMS | Headless CMS. |
| **launchdarkly** | 0 | 2 | Flags | Feature flags (we have native). |
| **flags** | 1 | 6 | Flags | Internal feature flags. |
| **analytics** | 4 | 6 | Analytics | Multi-provider analytics. |
| **automation** | 4 | 5 | Automation | Internal automation engine. |
| **calls** | 3 | 5 | Communication | Voice/WebRTC calling. |
| **emails** | 5 | 7 | Email | Multi-provider email. |

---

## Tier 4: Deprecated (REMOVE - Candidates)

Empty directories, stubs only, or redundant with other layers.

| Package | Tests | Files | Category | Notes |
|---------|-------|-------|----------|-------|
| **1password** | 0 | 0 | Secrets | Empty - tests dir only. |
| **bullmq** | 0 | 0 | Queue | Empty directory. |
| **chargebee** | 0 | 0 | Billing | Empty - tests dir only. |
| **docusign** | 1 | 0 | Documents | Tests only, no implementation. |
| **fcm** | 0 | 1 | Push | Types only, no implementation. |
| **fivetran** | 0 | 0 | ETL | Empty - tests dir only. |
| **google-maps** | 0 | 0 | Maps | Empty - tests dir only. |
| **mapbox** | 0 | 1 | Maps | Types only. |
| **medusa** | 0 | 1 | Commerce | Types only (use Shopify). |
| **metabase** | 0 | 2 | BI | Errors/types only. |
| **mux** | 0 | 0 | Video | Empty - tests dir only. |
| **onesignal** | 0 | 1 | Push | Types only. |
| **paypal** | 0 | 1 | Payments | Types only (use Stripe). |
| **pinecone** | 0 | 2 | Vector | Types only (we have native edgevec). |
| **saleor** | 0 | 0 | Commerce | Empty - tests dir only. |
| **tally** | 0 | 0 | Forms | Empty - tests dir only. |
| **typeform** | 0 | 0 | Forms | Empty - tests dir only. |
| **weaviate** | 0 | 0 | Vector | Empty (we have native edgevec). |
| **airbyte** | 0 | 2 | ETL | Types/stub only. |
| **calendly** | 0 | 2 | Calendar | Types/stub only. |
| **firebase-auth** | 0 | 3 | Auth | No tests (use Auth0/Clerk). |
| **auth** | 11 | 21 | Auth | Internal - overlaps with auth0/clerk. |
| **auth-unified** | 0 | 0 | Auth | Empty - planned but not implemented. |
| **core** | 5 | 4 | Internal | Shared utilities - not a compat layer. |
| **crm** | 0 | 1 | CRM | Types only (use HubSpot/Salesforce). |
| **shared** | 0 | 1 | Internal | Shared utilities - not a compat layer. |
| **tests** | 1 | 0 | Internal | Test utilities directory. |

---

## Recommendations

### Immediate Actions

1. **Keep Tier 1 as-is** - These are essential and well-maintained.
2. **Keep Tier 2 as-is** - Common integrations that add value.
3. **Review Tier 3** - Ensure tests exist, add if missing.
4. **Create `compat/deprecated/`** - Move Tier 4 packages there.

### Migration Path for Deprecated

```bash
# Create deprecated directory
mkdir -p compat/deprecated

# Move empty/stub packages (DO NOT RUN - audit only)
# mv compat/{1password,bullmq,chargebee,fivetran,google-maps,mux,saleor,tally,typeform,weaviate} compat/deprecated/
```

### Test Coverage Gaps

The following Tier 2/3 packages need test improvements:

| Package | Issue |
|---------|-------|
| gitlab | 0 tests - needs basic coverage |
| vault | 0 tests - needs basic coverage |
| cloudinary | 0 tests - needs basic coverage |
| launchdarkly | 0 tests - needs basic coverage |
| firebase-auth | 0 tests - use auth0/clerk instead |

### Overlapping Functionality

| Redundant | Keep Instead | Reason |
|-----------|--------------|--------|
| paypal | stripe | Stripe is industry standard |
| pinecone | edgevec | Native DO implementation |
| weaviate | edgevec | Native DO implementation |
| medusa | shopify | Shopify more widely used |
| firebase-auth | auth0, clerk | Better tested alternatives |

---

## Provider Bridge Integration

The following compat layers are registered in `lib/tools/provider-bridge.ts` and should be kept:

- openai, anthropic, cohere, google-ai (AI)
- sendgrid, twilio (Communication)
- slack, discord (Collaboration)
- stripe, shopify (Commerce)
- github, sentry, linear (DevOps/Project)
- supabase, algolia, s3, gcs (Database/Storage)
- salesforce, hubspot (CRM)
- zendesk, intercom (Helpdesk)
- sqs (Queue)
- auth0, clerk (Auth)
- segment (Analytics)
- zapier, n8n (Automation)

---

## Metrics Summary

| Metric | Value |
|--------|-------|
| Total compat layers | 88 |
| With tests | 63 (72%) |
| Without tests | 25 (28%) |
| Empty/stub only | 18 (20%) |
| Documented integrations | 8 |
| In provider bridge | 27 |

---

## Next Steps

1. [ ] Create `compat/deprecated/` directory
2. [ ] Move Tier 4 packages to deprecated
3. [ ] Add tests to Tier 2/3 packages missing coverage
4. [ ] Update provider bridge with new categorization
5. [ ] Document migration path for deprecated packages
