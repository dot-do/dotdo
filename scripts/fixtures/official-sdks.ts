/**
 * Official SDK Signatures Fixture
 *
 * This file defines the expected exports from official SDKs that our compat layers
 * should implement. Used by detect-gaps.ts to identify API coverage gaps.
 *
 * Structure:
 * - Each SDK has a list of exports with metadata
 * - Exports are categorized by type (class, function, type, constant)
 * - Severity indicates importance: P0 = core, P1 = common, P2 = edge case
 */

export type ExportType = 'class' | 'function' | 'type' | 'constant' | 'namespace'
export type Severity = 'P0' | 'P1' | 'P2'

export interface OfficialExport {
  name: string
  type: ExportType
  severity: Severity
  /** For nested exports like stripe.customers.create */
  path?: string
  /** Brief description of what this export does */
  description?: string
  /** Method signatures for classes/namespaces */
  methods?: OfficialMethod[]
}

export interface OfficialMethod {
  name: string
  severity: Severity
  description?: string
}

export interface OfficialSDK {
  /** NPM package name */
  package: string
  /** Our compat package path */
  compatPath: string
  /** Documentation URL */
  docsUrl: string
  /** All expected exports */
  exports: OfficialExport[]
}

// =============================================================================
// Stripe SDK
// https://github.com/stripe/stripe-node
// =============================================================================

export const stripe: OfficialSDK = {
  package: 'stripe',
  compatPath: 'compat/stripe',
  docsUrl: 'https://stripe.com/docs/api',
  exports: [
    // Main client class
    {
      name: 'Stripe',
      type: 'class',
      severity: 'P0',
      description: 'Main Stripe client',
      methods: [
        { name: 'customers', severity: 'P0', description: 'Customers resource' },
        { name: 'subscriptions', severity: 'P0', description: 'Subscriptions resource' },
        { name: 'paymentIntents', severity: 'P0', description: 'Payment Intents resource' },
        { name: 'charges', severity: 'P0', description: 'Charges resource' },
        { name: 'refunds', severity: 'P0', description: 'Refunds resource' },
        { name: 'paymentMethods', severity: 'P0', description: 'Payment Methods resource' },
        { name: 'products', severity: 'P1', description: 'Products resource' },
        { name: 'prices', severity: 'P1', description: 'Prices resource' },
        { name: 'invoices', severity: 'P1', description: 'Invoices resource' },
        { name: 'checkout', severity: 'P0', description: 'Checkout Sessions resource' },
        { name: 'accounts', severity: 'P1', description: 'Connect Accounts resource' },
        { name: 'transfers', severity: 'P1', description: 'Transfers resource' },
        { name: 'payouts', severity: 'P1', description: 'Payouts resource' },
        { name: 'webhookEndpoints', severity: 'P1', description: 'Webhook Endpoints resource' },
        { name: 'setupIntents', severity: 'P1', description: 'Setup Intents resource' },
        { name: 'coupons', severity: 'P2', description: 'Coupons resource' },
        { name: 'promotionCodes', severity: 'P2', description: 'Promotion Codes resource' },
        { name: 'taxRates', severity: 'P2', description: 'Tax Rates resource' },
        { name: 'disputes', severity: 'P2', description: 'Disputes resource' },
        { name: 'files', severity: 'P2', description: 'Files resource' },
        { name: 'fileLinks', severity: 'P2', description: 'File Links resource' },
        { name: 'balanceTransactions', severity: 'P2', description: 'Balance Transactions resource' },
        { name: 'events', severity: 'P1', description: 'Events resource' },
      ],
    },
    // Webhooks namespace
    {
      name: 'webhooks',
      type: 'namespace',
      path: 'Stripe.webhooks',
      severity: 'P0',
      description: 'Webhook signature verification',
      methods: [
        { name: 'constructEvent', severity: 'P0', description: 'Verify and construct webhook event' },
        { name: 'generateTestHeaderString', severity: 'P2', description: 'Generate test webhook header' },
      ],
    },
    // Error classes
    { name: 'StripeError', type: 'class', severity: 'P0', description: 'Base error class' },
    { name: 'StripeCardError', type: 'class', severity: 'P1', description: 'Card error' },
    { name: 'StripeInvalidRequestError', type: 'class', severity: 'P1', description: 'Invalid request error' },
    { name: 'StripeAPIError', type: 'class', severity: 'P1', description: 'API error' },
    { name: 'StripeAuthenticationError', type: 'class', severity: 'P1', description: 'Auth error' },
    { name: 'StripeRateLimitError', type: 'class', severity: 'P2', description: 'Rate limit error' },
    { name: 'StripePermissionError', type: 'class', severity: 'P2', description: 'Permission error' },
    { name: 'StripeConnectionError', type: 'class', severity: 'P2', description: 'Connection error' },
    { name: 'StripeSignatureVerificationError', type: 'class', severity: 'P1', description: 'Signature verification error' },
    // Core types
    { name: 'Customer', type: 'type', severity: 'P0', description: 'Customer object type' },
    { name: 'Subscription', type: 'type', severity: 'P0', description: 'Subscription object type' },
    { name: 'PaymentIntent', type: 'type', severity: 'P0', description: 'Payment Intent object type' },
    { name: 'Charge', type: 'type', severity: 'P0', description: 'Charge object type' },
    { name: 'Refund', type: 'type', severity: 'P0', description: 'Refund object type' },
    { name: 'PaymentMethod', type: 'type', severity: 'P0', description: 'Payment Method object type' },
    { name: 'Product', type: 'type', severity: 'P1', description: 'Product object type' },
    { name: 'Price', type: 'type', severity: 'P1', description: 'Price object type' },
    { name: 'Invoice', type: 'type', severity: 'P1', description: 'Invoice object type' },
    { name: 'CheckoutSession', type: 'type', severity: 'P0', description: 'Checkout Session type' },
    { name: 'Account', type: 'type', severity: 'P1', description: 'Connect Account type' },
    { name: 'Transfer', type: 'type', severity: 'P1', description: 'Transfer type' },
    { name: 'Payout', type: 'type', severity: 'P1', description: 'Payout type' },
    { name: 'WebhookEvent', type: 'type', severity: 'P0', description: 'Webhook event type' },
    { name: 'Metadata', type: 'type', severity: 'P0', description: 'Metadata type' },
    { name: 'Address', type: 'type', severity: 'P1', description: 'Address type' },
    { name: 'ListResponse', type: 'type', severity: 'P0', description: 'Paginated list response' },
  ],
}

// =============================================================================
// node-postgres (pg)
// https://node-postgres.com/
// =============================================================================

export const postgres: OfficialSDK = {
  package: 'pg',
  compatPath: 'compat/postgres',
  docsUrl: 'https://node-postgres.com/',
  exports: [
    // Core classes
    {
      name: 'Client',
      type: 'class',
      severity: 'P0',
      description: 'Single connection client',
      methods: [
        { name: 'connect', severity: 'P0', description: 'Connect to database' },
        { name: 'query', severity: 'P0', description: 'Execute query' },
        { name: 'end', severity: 'P0', description: 'Close connection' },
        { name: 'on', severity: 'P1', description: 'Event listener' },
        { name: 'once', severity: 'P2', description: 'One-time event listener' },
        { name: 'removeListener', severity: 'P2', description: 'Remove event listener' },
      ],
    },
    {
      name: 'Pool',
      type: 'class',
      severity: 'P0',
      description: 'Connection pool',
      methods: [
        { name: 'connect', severity: 'P0', description: 'Get client from pool' },
        { name: 'query', severity: 'P0', description: 'Execute query directly' },
        { name: 'end', severity: 'P0', description: 'Close all connections' },
        { name: 'on', severity: 'P1', description: 'Event listener' },
        { name: 'totalCount', severity: 'P2', description: 'Total connections' },
        { name: 'idleCount', severity: 'P2', description: 'Idle connections' },
        { name: 'waitingCount', severity: 'P2', description: 'Waiting requests' },
      ],
    },
    // Error classes
    { name: 'DatabaseError', type: 'class', severity: 'P0', description: 'Database error with SQLSTATE' },
    { name: 'ConnectionError', type: 'class', severity: 'P1', description: 'Connection error' },
    // Types
    { name: 'types', type: 'constant', severity: 'P1', description: 'Type parsers' },
    { name: 'native', type: 'constant', severity: 'P2', description: 'Native bindings (optional)' },
    // Query result types
    { name: 'QueryResult', type: 'type', severity: 'P0', description: 'Query result type' },
    { name: 'QueryArrayResult', type: 'type', severity: 'P1', description: 'Array mode result' },
    { name: 'QueryConfig', type: 'type', severity: 'P0', description: 'Query configuration' },
    { name: 'FieldDef', type: 'type', severity: 'P1', description: 'Field definition' },
    // Config types
    { name: 'ClientConfig', type: 'type', severity: 'P0', description: 'Client config' },
    { name: 'PoolConfig', type: 'type', severity: 'P0', description: 'Pool config' },
    { name: 'ConnectionConfig', type: 'type', severity: 'P1', description: 'Connection config' },
    { name: 'PoolClient', type: 'type', severity: 'P0', description: 'Pool client type' },
    // Cursor (optional)
    { name: 'Cursor', type: 'class', severity: 'P2', description: 'Cursor for large results' },
  ],
}

// =============================================================================
// Pusher Channels (pusher-js)
// https://github.com/pusher/pusher-js
// =============================================================================

export const pusher: OfficialSDK = {
  package: 'pusher-js',
  compatPath: 'compat/pusher',
  docsUrl: 'https://pusher.com/docs/channels/using_channels/client-api-overview/',
  exports: [
    // Main client
    {
      name: 'Pusher',
      type: 'class',
      severity: 'P0',
      description: 'Main Pusher client',
      methods: [
        { name: 'subscribe', severity: 'P0', description: 'Subscribe to channel' },
        { name: 'unsubscribe', severity: 'P0', description: 'Unsubscribe from channel' },
        { name: 'channel', severity: 'P1', description: 'Get existing channel' },
        { name: 'allChannels', severity: 'P2', description: 'Get all subscribed channels' },
        { name: 'connect', severity: 'P0', description: 'Connect to Pusher' },
        { name: 'disconnect', severity: 'P0', description: 'Disconnect from Pusher' },
        { name: 'bind', severity: 'P0', description: 'Bind global event' },
        { name: 'unbind', severity: 'P1', description: 'Unbind global event' },
        { name: 'bind_global', severity: 'P1', description: 'Bind to all events' },
        { name: 'unbind_global', severity: 'P2', description: 'Unbind from all events' },
      ],
    },
    // Connection
    {
      name: 'connection',
      type: 'namespace',
      path: 'Pusher.connection',
      severity: 'P0',
      description: 'Connection state management',
      methods: [
        { name: 'bind', severity: 'P0', description: 'Bind connection event' },
        { name: 'unbind', severity: 'P1', description: 'Unbind connection event' },
        { name: 'state', severity: 'P0', description: 'Current connection state' },
        { name: 'socket_id', severity: 'P0', description: 'Socket ID' },
      ],
    },
    // Channel types
    { name: 'Channel', type: 'type', severity: 'P0', description: 'Channel interface' },
    { name: 'PrivateChannel', type: 'type', severity: 'P0', description: 'Private channel' },
    { name: 'PresenceChannel', type: 'type', severity: 'P0', description: 'Presence channel' },
    { name: 'Members', type: 'type', severity: 'P0', description: 'Presence members' },
    // Config types
    { name: 'PusherOptions', type: 'type', severity: 'P0', description: 'Client options' },
    { name: 'AuthOptions', type: 'type', severity: 'P1', description: 'Auth options' },
    { name: 'Authorizer', type: 'type', severity: 'P1', description: 'Custom authorizer' },
    // Connection types
    { name: 'Connection', type: 'type', severity: 'P0', description: 'Connection type' },
    { name: 'ConnectionState', type: 'type', severity: 'P0', description: 'Connection state enum' },
    { name: 'StateChange', type: 'type', severity: 'P1', description: 'State change event' },
    // Error classes
    { name: 'PusherError', type: 'class', severity: 'P1', description: 'Pusher error' },
    { name: 'ConnectionError', type: 'class', severity: 'P1', description: 'Connection error' },
    { name: 'AuthError', type: 'class', severity: 'P1', description: 'Authentication error' },
  ],
}

// =============================================================================
// OpenAI
// https://github.com/openai/openai-node
// =============================================================================

export const openai: OfficialSDK = {
  package: 'openai',
  compatPath: 'compat/openai',
  docsUrl: 'https://platform.openai.com/docs/api-reference',
  exports: [
    {
      name: 'OpenAI',
      type: 'class',
      severity: 'P0',
      description: 'Main OpenAI client',
      methods: [
        { name: 'chat', severity: 'P0', description: 'Chat completions' },
        { name: 'completions', severity: 'P1', description: 'Text completions (legacy)' },
        { name: 'embeddings', severity: 'P0', description: 'Text embeddings' },
        { name: 'images', severity: 'P1', description: 'Image generation' },
        { name: 'audio', severity: 'P1', description: 'Audio (speech/transcription)' },
        { name: 'files', severity: 'P1', description: 'File management' },
        { name: 'fineTuning', severity: 'P2', description: 'Fine-tuning' },
        { name: 'models', severity: 'P1', description: 'Model listing' },
        { name: 'moderations', severity: 'P2', description: 'Content moderation' },
        { name: 'assistants', severity: 'P1', description: 'Assistants API' },
        { name: 'threads', severity: 'P1', description: 'Threads API' },
        { name: 'beta', severity: 'P2', description: 'Beta features' },
      ],
    },
    // Core types
    { name: 'ChatCompletion', type: 'type', severity: 'P0', description: 'Chat completion response' },
    { name: 'ChatCompletionMessage', type: 'type', severity: 'P0', description: 'Chat message' },
    { name: 'ChatCompletionChunk', type: 'type', severity: 'P0', description: 'Streaming chunk' },
    { name: 'Embedding', type: 'type', severity: 'P0', description: 'Embedding response' },
    { name: 'Image', type: 'type', severity: 'P1', description: 'Generated image' },
    // Error classes
    { name: 'OpenAIError', type: 'class', severity: 'P0', description: 'Base error' },
    { name: 'APIError', type: 'class', severity: 'P0', description: 'API error' },
    { name: 'AuthenticationError', type: 'class', severity: 'P1', description: 'Auth error' },
    { name: 'RateLimitError', type: 'class', severity: 'P1', description: 'Rate limit error' },
  ],
}

// =============================================================================
// AWS S3
// https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/
// =============================================================================

export const s3: OfficialSDK = {
  package: '@aws-sdk/client-s3',
  compatPath: 'compat/s3',
  docsUrl: 'https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/',
  exports: [
    {
      name: 'S3Client',
      type: 'class',
      severity: 'P0',
      description: 'S3 client',
      methods: [
        { name: 'send', severity: 'P0', description: 'Send command' },
        { name: 'destroy', severity: 'P2', description: 'Destroy client' },
      ],
    },
    // Commands
    { name: 'PutObjectCommand', type: 'class', severity: 'P0', description: 'Upload object' },
    { name: 'GetObjectCommand', type: 'class', severity: 'P0', description: 'Download object' },
    { name: 'DeleteObjectCommand', type: 'class', severity: 'P0', description: 'Delete object' },
    { name: 'ListObjectsV2Command', type: 'class', severity: 'P0', description: 'List objects' },
    { name: 'HeadObjectCommand', type: 'class', severity: 'P1', description: 'Get object metadata' },
    { name: 'CopyObjectCommand', type: 'class', severity: 'P1', description: 'Copy object' },
    { name: 'CreateBucketCommand', type: 'class', severity: 'P1', description: 'Create bucket' },
    { name: 'DeleteBucketCommand', type: 'class', severity: 'P1', description: 'Delete bucket' },
    { name: 'ListBucketsCommand', type: 'class', severity: 'P1', description: 'List buckets' },
    { name: 'CreateMultipartUploadCommand', type: 'class', severity: 'P1', description: 'Start multipart' },
    { name: 'UploadPartCommand', type: 'class', severity: 'P1', description: 'Upload part' },
    { name: 'CompleteMultipartUploadCommand', type: 'class', severity: 'P1', description: 'Complete multipart' },
    { name: 'AbortMultipartUploadCommand', type: 'class', severity: 'P2', description: 'Abort multipart' },
    // Types
    { name: 'S3ClientConfig', type: 'type', severity: 'P0', description: 'Client config' },
    { name: 'PutObjectCommandInput', type: 'type', severity: 'P0', description: 'Put object input' },
    { name: 'GetObjectCommandOutput', type: 'type', severity: 'P0', description: 'Get object output' },
    { name: 'ListObjectsV2CommandOutput', type: 'type', severity: 'P0', description: 'List output' },
  ],
}

// =============================================================================
// SendGrid
// https://github.com/sendgrid/sendgrid-nodejs
// =============================================================================

export const sendgrid: OfficialSDK = {
  package: '@sendgrid/mail',
  compatPath: 'compat/sendgrid',
  docsUrl: 'https://docs.sendgrid.com/api-reference/mail-send/mail-send',
  exports: [
    {
      name: 'MailService',
      type: 'class',
      severity: 'P0',
      description: 'Mail service client',
      methods: [
        { name: 'setApiKey', severity: 'P0', description: 'Set API key' },
        { name: 'send', severity: 'P0', description: 'Send email' },
        { name: 'sendMultiple', severity: 'P1', description: 'Send multiple emails' },
      ],
    },
    { name: 'send', type: 'function', severity: 'P0', description: 'Send email function' },
    { name: 'setApiKey', type: 'function', severity: 'P0', description: 'Set API key function' },
    // Types
    { name: 'MailDataRequired', type: 'type', severity: 'P0', description: 'Email data type' },
    { name: 'PersonalizationData', type: 'type', severity: 'P1', description: 'Personalization' },
    { name: 'AttachmentData', type: 'type', severity: 'P1', description: 'Attachment data' },
  ],
}

// =============================================================================
// Sentry
// https://docs.sentry.io/platforms/javascript/
// =============================================================================

export const sentry: OfficialSDK = {
  package: '@sentry/node',
  compatPath: 'compat/sentry',
  docsUrl: 'https://docs.sentry.io/platforms/javascript/',
  exports: [
    { name: 'init', type: 'function', severity: 'P0', description: 'Initialize Sentry' },
    { name: 'captureException', type: 'function', severity: 'P0', description: 'Capture exception' },
    { name: 'captureMessage', type: 'function', severity: 'P0', description: 'Capture message' },
    { name: 'captureEvent', type: 'function', severity: 'P1', description: 'Capture event' },
    { name: 'setUser', type: 'function', severity: 'P0', description: 'Set user context' },
    { name: 'setTag', type: 'function', severity: 'P1', description: 'Set tag' },
    { name: 'setTags', type: 'function', severity: 'P1', description: 'Set multiple tags' },
    { name: 'setExtra', type: 'function', severity: 'P1', description: 'Set extra data' },
    { name: 'setExtras', type: 'function', severity: 'P1', description: 'Set multiple extras' },
    { name: 'setContext', type: 'function', severity: 'P1', description: 'Set context' },
    { name: 'addBreadcrumb', type: 'function', severity: 'P1', description: 'Add breadcrumb' },
    { name: 'withScope', type: 'function', severity: 'P1', description: 'Run with scope' },
    { name: 'configureScope', type: 'function', severity: 'P1', description: 'Configure scope' },
    { name: 'startTransaction', type: 'function', severity: 'P1', description: 'Start transaction' },
    { name: 'flush', type: 'function', severity: 'P1', description: 'Flush events' },
    { name: 'close', type: 'function', severity: 'P2', description: 'Close SDK' },
    // Types
    { name: 'SentryOptions', type: 'type', severity: 'P0', description: 'Init options' },
    { name: 'Event', type: 'type', severity: 'P1', description: 'Sentry event' },
    { name: 'User', type: 'type', severity: 'P0', description: 'User context' },
    { name: 'Breadcrumb', type: 'type', severity: 'P1', description: 'Breadcrumb type' },
  ],
}

// =============================================================================
// Algolia
// https://www.algolia.com/doc/api-client/getting-started/install/javascript/
// =============================================================================

export const algolia: OfficialSDK = {
  package: 'algoliasearch',
  compatPath: 'compat/algolia',
  docsUrl: 'https://www.algolia.com/doc/api-reference/api-methods/',
  exports: [
    {
      name: 'algoliasearch',
      type: 'function',
      severity: 'P0',
      description: 'Create Algolia client',
    },
    {
      name: 'SearchClient',
      type: 'class',
      severity: 'P0',
      description: 'Search client',
      methods: [
        { name: 'initIndex', severity: 'P0', description: 'Get index' },
        { name: 'search', severity: 'P0', description: 'Multi-index search' },
        { name: 'searchForFacetValues', severity: 'P1', description: 'Facet search' },
        { name: 'multipleQueries', severity: 'P1', description: 'Multiple queries' },
        { name: 'listIndices', severity: 'P2', description: 'List all indices' },
        { name: 'copyIndex', severity: 'P2', description: 'Copy index' },
        { name: 'moveIndex', severity: 'P2', description: 'Move index' },
      ],
    },
    {
      name: 'SearchIndex',
      type: 'class',
      severity: 'P0',
      description: 'Index operations',
      methods: [
        { name: 'search', severity: 'P0', description: 'Search index' },
        { name: 'saveObject', severity: 'P0', description: 'Save object' },
        { name: 'saveObjects', severity: 'P0', description: 'Save multiple objects' },
        { name: 'getObject', severity: 'P0', description: 'Get object' },
        { name: 'getObjects', severity: 'P1', description: 'Get multiple objects' },
        { name: 'deleteObject', severity: 'P0', description: 'Delete object' },
        { name: 'deleteObjects', severity: 'P1', description: 'Delete multiple objects' },
        { name: 'partialUpdateObject', severity: 'P1', description: 'Partial update' },
        { name: 'partialUpdateObjects', severity: 'P1', description: 'Partial update multiple' },
        { name: 'setSettings', severity: 'P1', description: 'Set index settings' },
        { name: 'getSettings', severity: 'P1', description: 'Get index settings' },
        { name: 'clearObjects', severity: 'P2', description: 'Clear all objects' },
        { name: 'delete', severity: 'P2', description: 'Delete index' },
        { name: 'browse', severity: 'P2', description: 'Browse all objects' },
      ],
    },
    // Types
    { name: 'SearchOptions', type: 'type', severity: 'P0', description: 'Search options' },
    { name: 'SearchResponse', type: 'type', severity: 'P0', description: 'Search response' },
    { name: 'Hit', type: 'type', severity: 'P0', description: 'Search hit' },
    { name: 'IndexSettings', type: 'type', severity: 'P1', description: 'Index settings' },
  ],
}

// =============================================================================
// Supabase
// https://supabase.com/docs/reference/javascript/
// =============================================================================

export const supabase: OfficialSDK = {
  package: '@supabase/supabase-js',
  compatPath: 'compat/supabase',
  docsUrl: 'https://supabase.com/docs/reference/javascript/',
  exports: [
    {
      name: 'createClient',
      type: 'function',
      severity: 'P0',
      description: 'Create Supabase client',
    },
    {
      name: 'SupabaseClient',
      type: 'class',
      severity: 'P0',
      description: 'Supabase client',
      methods: [
        { name: 'from', severity: 'P0', description: 'Table query builder' },
        { name: 'rpc', severity: 'P1', description: 'Call stored procedure' },
        { name: 'channel', severity: 'P1', description: 'Realtime channel' },
        { name: 'removeChannel', severity: 'P2', description: 'Remove channel' },
        { name: 'removeAllChannels', severity: 'P2', description: 'Remove all channels' },
        { name: 'getChannels', severity: 'P2', description: 'Get all channels' },
      ],
    },
    {
      name: 'auth',
      type: 'namespace',
      path: 'SupabaseClient.auth',
      severity: 'P0',
      description: 'Auth methods',
      methods: [
        { name: 'signUp', severity: 'P0', description: 'Sign up' },
        { name: 'signInWithPassword', severity: 'P0', description: 'Sign in with password' },
        { name: 'signInWithOAuth', severity: 'P0', description: 'OAuth sign in' },
        { name: 'signOut', severity: 'P0', description: 'Sign out' },
        { name: 'getSession', severity: 'P0', description: 'Get session' },
        { name: 'getUser', severity: 'P0', description: 'Get user' },
        { name: 'refreshSession', severity: 'P1', description: 'Refresh session' },
        { name: 'updateUser', severity: 'P1', description: 'Update user' },
        { name: 'resetPasswordForEmail', severity: 'P1', description: 'Reset password' },
        { name: 'onAuthStateChange', severity: 'P0', description: 'Auth state listener' },
      ],
    },
    {
      name: 'storage',
      type: 'namespace',
      path: 'SupabaseClient.storage',
      severity: 'P1',
      description: 'Storage methods',
      methods: [
        { name: 'from', severity: 'P0', description: 'Get bucket' },
        { name: 'listBuckets', severity: 'P1', description: 'List buckets' },
        { name: 'getBucket', severity: 'P1', description: 'Get bucket' },
        { name: 'createBucket', severity: 'P1', description: 'Create bucket' },
        { name: 'deleteBucket', severity: 'P2', description: 'Delete bucket' },
      ],
    },
    // Types
    { name: 'SupabaseClientOptions', type: 'type', severity: 'P0', description: 'Client options' },
    { name: 'PostgrestResponse', type: 'type', severity: 'P0', description: 'Query response' },
    { name: 'User', type: 'type', severity: 'P0', description: 'User type' },
    { name: 'Session', type: 'type', severity: 'P0', description: 'Session type' },
  ],
}

// =============================================================================
// All SDKs registry
// =============================================================================

export const officialSDKs: Record<string, OfficialSDK> = {
  stripe,
  postgres,
  pusher,
  openai,
  s3,
  sendgrid,
  sentry,
  algolia,
  supabase,
}

export default officialSDKs
