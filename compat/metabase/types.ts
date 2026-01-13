/**
 * @dotdo/metabase - Type Definitions
 *
 * TypeScript types matching the Metabase API.
 */

// =============================================================================
// Core Types
// =============================================================================

export type ID = number
export type DateTime = string
export type JSONObject = Record<string, unknown>

// =============================================================================
// User Types
// =============================================================================

export interface User {
  id: ID
  email: string
  first_name: string
  last_name: string
  common_name: string
  is_superuser: boolean
  is_active: boolean
  date_joined: DateTime
  last_login?: DateTime
  updated_at?: DateTime
  locale?: string
  google_auth?: boolean
  ldap_auth?: boolean
  group_ids: number[]
}

export interface UserCreateInput {
  email: string
  first_name: string
  last_name: string
  password?: string
  group_ids?: number[]
}

export interface UserUpdateInput {
  email?: string
  first_name?: string
  last_name?: string
  is_superuser?: boolean
  is_active?: boolean
  locale?: string
  group_ids?: number[]
}

export interface SessionInfo {
  id: string
  user_id: ID
  created_at: DateTime
}

// =============================================================================
// Database Types
// =============================================================================

export type DatabaseEngine =
  | 'postgres'
  | 'mysql'
  | 'h2'
  | 'sqlite'
  | 'bigquery'
  | 'redshift'
  | 'snowflake'
  | 'presto'
  | 'sparksql'
  | 'mongo'

export interface Database {
  id: ID
  name: string
  description?: string
  engine: DatabaseEngine
  details: Record<string, unknown>
  is_sample: boolean
  is_on_demand: boolean
  is_full_sync: boolean
  cache_ttl?: number
  created_at: DateTime
  updated_at: DateTime
  tables?: Table[]
  schedules?: SyncSchedule
  features?: string[]
  auto_run_queries?: boolean
}

export interface DatabaseCreateInput {
  name: string
  engine: DatabaseEngine
  details: Record<string, unknown>
  is_full_sync?: boolean
  is_on_demand?: boolean
  cache_ttl?: number
  auto_run_queries?: boolean
}

export interface DatabaseUpdateInput {
  name?: string
  description?: string
  details?: Record<string, unknown>
  is_full_sync?: boolean
  is_on_demand?: boolean
  cache_ttl?: number
  auto_run_queries?: boolean
}

export interface SyncSchedule {
  metadata_sync?: string
  cache_field_values?: string
}

// =============================================================================
// Table Types
// =============================================================================

export type TableVisibility = 'visible' | 'hidden' | 'cruft' | 'technical'

export interface Table {
  id: ID
  db_id: ID
  name: string
  display_name: string
  description?: string
  schema?: string
  entity_type?: string
  visibility_type?: TableVisibility
  active: boolean
  created_at: DateTime
  updated_at: DateTime
  fields?: Field[]
  metrics?: Metric[]
  segments?: Segment[]
  pk_field?: ID
  rows?: number
}

export interface TableUpdateInput {
  display_name?: string
  description?: string
  visibility_type?: TableVisibility
  entity_type?: string
}

// =============================================================================
// Field Types
// =============================================================================

export type FieldType =
  | 'type/BigInteger'
  | 'type/Boolean'
  | 'type/Date'
  | 'type/DateTime'
  | 'type/Decimal'
  | 'type/Float'
  | 'type/Integer'
  | 'type/Text'
  | 'type/Time'
  | 'type/UUID'

export type FieldSemanticType =
  | 'type/PK'
  | 'type/FK'
  | 'type/Name'
  | 'type/Email'
  | 'type/URL'
  | 'type/Category'
  | 'type/City'
  | 'type/State'
  | 'type/Country'
  | 'type/ZipCode'
  | 'type/Latitude'
  | 'type/Longitude'
  | 'type/Number'
  | 'type/Currency'
  | 'type/Quantity'
  | 'type/CreationDate'
  | 'type/CreationTimestamp'

export interface Field {
  id: ID
  table_id: ID
  name: string
  display_name: string
  description?: string
  base_type: FieldType
  effective_type?: FieldType
  semantic_type?: FieldSemanticType
  fk_target_field_id?: ID
  has_field_values?: 'none' | 'auto-list' | 'list' | 'search'
  preview_display?: boolean
  position?: number
  visibility_type?: 'normal' | 'details-only' | 'hidden' | 'sensitive'
  active: boolean
  created_at: DateTime
  updated_at: DateTime
  fingerprint?: FieldFingerprint
  dimensions?: FieldDimension[]
}

export interface FieldFingerprint {
  global?: {
    'distinct-count'?: number
    'nil%'?: number
  }
  type?: Record<string, unknown>
}

export interface FieldDimension {
  id: ID
  field_id: ID
  name: string
  type: 'internal' | 'external'
  human_readable_field_id?: ID
}

export interface FieldUpdateInput {
  display_name?: string
  description?: string
  semantic_type?: FieldSemanticType | null
  visibility_type?: 'normal' | 'details-only' | 'hidden' | 'sensitive'
  has_field_values?: 'none' | 'auto-list' | 'list' | 'search'
}

// =============================================================================
// Question (Card) Types
// =============================================================================

export type QuestionType = 'question' | 'model' | 'metric'
export type QueryType = 'query' | 'native'

export interface Question {
  id: ID
  name: string
  description?: string
  display: DisplayType
  visualization_settings: Record<string, unknown>
  dataset_query: DatasetQuery
  result_metadata?: ResultMetadata[]
  collection_id?: ID
  collection_position?: number
  collection?: Collection
  archived: boolean
  enable_embedding: boolean
  embedding_params?: Record<string, 'enabled' | 'locked' | 'disabled'>
  made_public_by_id?: ID
  public_uuid?: string
  query_type: QueryType
  creator_id: ID
  creator?: User
  created_at: DateTime
  updated_at: DateTime
  cache_ttl?: number
  type: QuestionType
  parameter_mappings?: ParameterMapping[]
  parameters?: Parameter[]
}

export interface QuestionCreateInput {
  name: string
  description?: string
  display: DisplayType
  visualization_settings?: Record<string, unknown>
  dataset_query: DatasetQuery
  collection_id?: ID
  collection_position?: number
  type?: QuestionType
  result_metadata?: ResultMetadata[]
  cache_ttl?: number
  parameters?: Parameter[]
}

export interface QuestionUpdateInput {
  name?: string
  description?: string
  display?: DisplayType
  visualization_settings?: Record<string, unknown>
  dataset_query?: DatasetQuery
  collection_id?: ID
  collection_position?: number
  archived?: boolean
  enable_embedding?: boolean
  embedding_params?: Record<string, 'enabled' | 'locked' | 'disabled'>
  cache_ttl?: number
  result_metadata?: ResultMetadata[]
  parameters?: Parameter[]
}

// =============================================================================
// Query Types
// =============================================================================

export interface DatasetQuery {
  type: QueryType
  database: ID
  query?: StructuredQuery
  native?: NativeQuery
}

export interface StructuredQuery {
  'source-table'?: ID
  'source-query'?: StructuredQuery
  joins?: Join[]
  expressions?: Record<string, Expression>
  fields?: FieldReference[]
  filter?: Filter
  aggregation?: Aggregation[]
  breakout?: Breakout[]
  'order-by'?: OrderBy[]
  limit?: number
  page?: { page: number; items: number }
}

export interface NativeQuery {
  query: string
  'template-tags'?: Record<string, TemplateTag>
  collection?: string
}

export interface TemplateTag {
  id: string
  name: string
  'display-name': string
  type: 'text' | 'number' | 'date' | 'dimension' | 'card' | 'snippet'
  required?: boolean
  default?: unknown
  dimension?: FieldReference
  'widget-type'?: string
}

export type FieldReference =
  | ['field', ID, Record<string, unknown> | null]
  | ['field', string, Record<string, unknown>]
  | ['expression', string]
  | ['aggregation', number]

export type Expression = [string, ...unknown[]]
export type Filter = ['and' | 'or' | string, ...unknown[]]
export type Aggregation = [string, ...unknown[]]
export type Breakout = FieldReference | ['datetime-field', FieldReference, string]
export type OrderBy = ['asc' | 'desc', FieldReference]

export interface Join {
  alias: string
  'source-table'?: ID
  'source-query'?: StructuredQuery
  condition: Filter
  fields?: 'all' | 'none' | FieldReference[]
}

// =============================================================================
// Query Result Types
// =============================================================================

export interface QueryResult {
  data: QueryResultData
  json_query: DatasetQuery
  database_id: ID
  started_at: DateTime
  running_time: number
  average_execution_time?: number
  row_count: number
  status: 'completed' | 'failed' | 'canceled'
  context?: string
  error?: string
  error_type?: string
}

export interface QueryResultData {
  rows: unknown[][]
  cols: ResultColumn[]
  native_form?: { query: string; params?: unknown[] }
  results_metadata?: ResultMetadata
  results_timezone?: string
  insights?: QueryInsight[]
}

export interface ResultColumn {
  name: string
  display_name: string
  base_type: FieldType
  effective_type?: FieldType
  semantic_type?: FieldSemanticType
  field_ref?: FieldReference
  source?: 'native' | 'fields' | 'aggregation' | 'breakout'
  fingerprint?: FieldFingerprint
}

export interface ResultMetadata {
  name: string
  display_name: string
  base_type: FieldType
  effective_type?: FieldType
  semantic_type?: FieldSemanticType
  field_ref?: FieldReference
  fingerprint?: FieldFingerprint
}

export interface QueryInsight {
  type: string
  value: unknown
}

// =============================================================================
// Dashboard Types
// =============================================================================

export interface Dashboard {
  id: ID
  name: string
  description?: string
  collection_id?: ID
  collection_position?: number
  collection?: Collection
  creator_id: ID
  creator?: User
  parameters: Parameter[]
  dashcards: DashboardCard[]
  tabs?: DashboardTab[]
  archived: boolean
  enable_embedding: boolean
  embedding_params?: Record<string, 'enabled' | 'locked' | 'disabled'>
  made_public_by_id?: ID
  public_uuid?: string
  position?: number
  width?: 'full' | 'fixed'
  cache_ttl?: number
  created_at: DateTime
  updated_at: DateTime
}

export interface DashboardCreateInput {
  name: string
  description?: string
  collection_id?: ID
  collection_position?: number
  parameters?: Parameter[]
  cache_ttl?: number
  width?: 'full' | 'fixed'
}

export interface DashboardUpdateInput {
  name?: string
  description?: string
  collection_id?: ID
  collection_position?: number
  parameters?: Parameter[]
  archived?: boolean
  enable_embedding?: boolean
  embedding_params?: Record<string, 'enabled' | 'locked' | 'disabled'>
  cache_ttl?: number
  width?: 'full' | 'fixed'
}

export interface DashboardCard {
  id: ID
  dashboard_id: ID
  dashboard_tab_id?: ID
  card_id?: ID
  card?: Question
  row: number
  col: number
  size_x: number
  size_y: number
  visualization_settings: Record<string, unknown>
  parameter_mappings: ParameterMapping[]
  series?: Question[]
  created_at: DateTime
  updated_at: DateTime
}

export interface DashboardCardCreateInput {
  card_id?: ID
  dashboard_tab_id?: ID
  row?: number
  col?: number
  size_x?: number
  size_y?: number
  visualization_settings?: Record<string, unknown>
  parameter_mappings?: ParameterMapping[]
  series?: ID[]
}

export interface DashboardCardUpdateInput {
  row?: number
  col?: number
  size_x?: number
  size_y?: number
  visualization_settings?: Record<string, unknown>
  parameter_mappings?: ParameterMapping[]
  series?: ID[]
}

export interface DashboardTab {
  id: ID
  dashboard_id: ID
  name: string
  position: number
  created_at: DateTime
  updated_at: DateTime
}

// =============================================================================
// Collection Types
// =============================================================================

export type CollectionAuthority = 'official' | 'none'

export interface Collection {
  id: ID | 'root'
  name: string
  description?: string
  color?: string
  slug?: string
  namespace?: string
  personal_owner_id?: ID
  authority_level?: CollectionAuthority
  archived: boolean
  location?: string
  effective_location?: string
  parent_id?: ID
  effective_ancestors?: CollectionAncestor[]
  can_write: boolean
  created_at?: DateTime
}

export interface CollectionAncestor {
  id: ID
  name: string
  authority_level?: CollectionAuthority
}

export interface CollectionCreateInput {
  name: string
  description?: string
  color?: string
  parent_id?: ID | 'root'
  namespace?: string
  authority_level?: CollectionAuthority
}

export interface CollectionUpdateInput {
  name?: string
  description?: string
  color?: string
  parent_id?: ID | 'root'
  archived?: boolean
  authority_level?: CollectionAuthority
}

export interface CollectionItem {
  id: ID
  name: string
  description?: string
  model: 'card' | 'dashboard' | 'collection' | 'dataset' | 'snippet'
  collection_id?: ID
  collection_position?: number
  fully_parameterized?: boolean
  getLastEditInfo?: () => LastEditInfo
}

export interface LastEditInfo {
  id: ID
  email: string
  first_name: string
  last_name: string
  timestamp: DateTime
}

// =============================================================================
// Parameter Types
// =============================================================================

export type ParameterType =
  | 'category'
  | 'location/city'
  | 'location/state'
  | 'location/zip_code'
  | 'location/country'
  | 'id'
  | 'number/='
  | 'number/!='
  | 'number/>='
  | 'number/<='
  | 'number/between'
  | 'string/='
  | 'string/!='
  | 'string/contains'
  | 'string/does-not-contain'
  | 'string/starts-with'
  | 'string/ends-with'
  | 'date/single'
  | 'date/range'
  | 'date/relative'
  | 'date/month-year'
  | 'date/quarter-year'
  | 'date/all-options'

export interface Parameter {
  id: string
  name: string
  slug: string
  type: ParameterType
  default?: unknown
  required?: boolean
  sectionId?: string
  values_query_type?: 'none' | 'list' | 'search'
  values_source_type?: 'card' | 'static-list' | null
  values_source_config?: Record<string, unknown>
}

export interface ParameterMapping {
  parameter_id: string
  card_id?: ID
  target: ['dimension', FieldReference] | ['variable', ['template-tag', string]]
}

// =============================================================================
// Visualization Types
// =============================================================================

export type DisplayType =
  | 'table'
  | 'bar'
  | 'line'
  | 'area'
  | 'row'
  | 'pie'
  | 'scalar'
  | 'smartscalar'
  | 'progress'
  | 'gauge'
  | 'funnel'
  | 'combo'
  | 'scatter'
  | 'waterfall'
  | 'map'
  | 'pivot'

// =============================================================================
// Metric & Segment Types
// =============================================================================

export interface Metric {
  id: ID
  table_id: ID
  name: string
  description?: string
  definition: {
    aggregation: Aggregation[]
    filter?: Filter
  }
  archived: boolean
  creator_id: ID
  created_at: DateTime
  updated_at: DateTime
}

export interface MetricCreateInput {
  name: string
  description?: string
  table_id: ID
  definition: {
    aggregation: Aggregation[]
    filter?: Filter
  }
}

export interface Segment {
  id: ID
  table_id: ID
  name: string
  description?: string
  definition: {
    filter: Filter
  }
  archived: boolean
  creator_id: ID
  created_at: DateTime
  updated_at: DateTime
}

export interface SegmentCreateInput {
  name: string
  description?: string
  table_id: ID
  definition: {
    filter: Filter
  }
}

// =============================================================================
// Snippet Types
// =============================================================================

export interface NativeQuerySnippet {
  id: ID
  name: string
  description?: string
  content: string
  collection_id?: ID
  creator_id: ID
  creator?: User
  archived: boolean
  created_at: DateTime
  updated_at: DateTime
}

export interface NativeQuerySnippetCreateInput {
  name: string
  description?: string
  content: string
  collection_id?: ID
}

export interface NativeQuerySnippetUpdateInput {
  name?: string
  description?: string
  content?: string
  collection_id?: ID
  archived?: boolean
}

// =============================================================================
// Embedding Types
// =============================================================================

export interface EmbedToken {
  token: string
  resource: { question?: ID; dashboard?: ID }
  params: Record<string, unknown>
  exp: number
}

export interface EmbedSettings {
  enable_embedding: boolean
  embedding_secret_key?: string
  embedding_app_origin?: string
}

// =============================================================================
// Permissions Types
// =============================================================================

export interface PermissionsGroup {
  id: ID
  name: string
  member_count: number
}

export interface PermissionsGraph {
  revision: number
  groups: Record<string, Record<string, DatabasePermission>>
}

export interface DatabasePermission {
  data?: {
    schemas?: 'all' | 'none' | 'block' | Record<string, TablePermission>
    native?: 'write' | 'none'
  }
  download?: {
    schemas?: 'full' | 'limited' | 'none' | Record<string, 'full' | 'limited' | 'none'>
  }
  data_model?: {
    schemas?: 'all' | 'none' | Record<string, 'all' | 'none'>
  }
  details?: 'yes' | 'no'
}

export interface TablePermission {
  [tableName: string]: 'all' | 'none' | 'block'
}

// =============================================================================
// Activity Types
// =============================================================================

export interface Activity {
  id: ID
  topic: string
  timestamp: DateTime
  user_id?: ID
  user?: User
  model?: string
  model_id?: ID
  database_id?: ID
  table_id?: ID
  custom_id?: string
  details: Record<string, unknown>
}

// =============================================================================
// Setup Types
// =============================================================================

export interface SetupToken {
  token: string
  valid: boolean
}

export interface SetupInput {
  token: string
  user: {
    email: string
    password: string
    first_name: string
    last_name: string
    site_name: string
  }
  prefs?: {
    site_name?: string
    site_locale?: string
    allow_tracking?: boolean
  }
  database?: DatabaseCreateInput
}

// =============================================================================
// Client Config Types
// =============================================================================

export interface MetabaseClientConfig {
  /**
   * Base URL of the Metabase instance
   */
  url?: string

  /**
   * Session token for authentication
   */
  sessionToken?: string

  /**
   * Username (email) for authentication
   */
  username?: string

  /**
   * Password for authentication
   */
  password?: string

  /**
   * API key for authentication
   */
  apiKey?: string

  /**
   * Custom fetch implementation
   */
  fetch?: typeof fetch

  /**
   * Default database ID for queries
   */
  defaultDatabaseId?: ID
}

export interface MetabaseLocalConfig {
  /**
   * Enable webhook notifications
   */
  webhooks?: boolean

  /**
   * Webhook callback
   */
  onWebhookEvent?: (event: Activity) => void

  /**
   * Initial admin user
   */
  adminUser?: UserCreateInput

  /**
   * Sample database with demo data
   */
  includeSampleDatabase?: boolean
}

// =============================================================================
// Pagination Types
// =============================================================================

export interface PaginationParams {
  offset?: number
  limit?: number
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  limit: number
  offset: number
}
