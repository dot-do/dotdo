/**
 * @dotdo/salesforce/einstein - Salesforce Einstein AI Integration Hooks
 *
 * Provides integration hooks for Salesforce Einstein AI services including:
 * - Einstein Predictions (Prediction Builder, Einstein Discovery)
 * - Einstein Next Best Action
 * - Einstein Vision and Language
 * - Einstein Bots
 * - Einstein GPT (Generative AI)
 *
 * @example
 * ```typescript
 * import { Einstein, EinsteinPredictionBuilder } from '@dotdo/salesforce'
 *
 * // Initialize Einstein client
 * const einstein = new Einstein(conn)
 *
 * // Get predictions for a record
 * const predictions = await einstein.predictions.getPredictions('Lead', '00Q...')
 *
 * // Get next best actions
 * const actions = await einstein.nextBestAction.getRecommendations({
 *   contextRecordId: '003...',
 *   strategy: 'MyStrategy',
 * })
 *
 * // Use Einstein GPT
 * const response = await einstein.gpt.generate({
 *   prompt: 'Summarize this account',
 *   context: { recordId: '001...' },
 * })
 * ```
 *
 * @module @dotdo/salesforce/einstein
 */

import type { Connection } from './salesforce'
import type { SObject, QueryResult } from './types'

// =============================================================================
// Hook Types - Allow users to intercept and customize Einstein behavior
// =============================================================================

/**
 * Hook function signature for intercepting Einstein operations
 */
export type EinsteinHook<TInput, TOutput> = (
  input: TInput,
  next: (input: TInput) => Promise<TOutput>
) => Promise<TOutput>

/**
 * Hook registry for all Einstein operations
 */
export interface EinsteinHooks {
  // Prediction hooks
  beforeGetPrediction?: EinsteinHook<GetPredictionInput, PredictionResult>
  afterGetPrediction?: (result: PredictionResult) => Promise<PredictionResult>

  // Next Best Action hooks
  beforeGetRecommendations?: EinsteinHook<GetRecommendationsInput, RecommendationResult>
  afterGetRecommendations?: (result: RecommendationResult) => Promise<RecommendationResult>

  // Vision hooks
  beforeAnalyzeImage?: EinsteinHook<AnalyzeImageInput, VisionResult>
  afterAnalyzeImage?: (result: VisionResult) => Promise<VisionResult>

  // Language hooks
  beforeAnalyzeText?: EinsteinHook<AnalyzeTextInput, LanguageResult>
  afterAnalyzeText?: (result: LanguageResult) => Promise<LanguageResult>

  // GPT hooks
  beforeGenerate?: EinsteinHook<GenerateInput, GenerateResult>
  afterGenerate?: (result: GenerateResult) => Promise<GenerateResult>

  // Bot hooks
  beforeSendMessage?: EinsteinHook<BotMessageInput, BotMessageResult>
  afterSendMessage?: (result: BotMessageResult) => Promise<BotMessageResult>

  // Generic error handler
  onError?: (error: EinsteinError, operation: string) => Promise<void>
}

// =============================================================================
// Prediction Types
// =============================================================================

/**
 * Prediction model types
 */
export type PredictionModelType =
  | 'PredictionDefinition' // Einstein Prediction Builder
  | 'Discovery' // Einstein Discovery
  | 'Custom' // Custom model

/**
 * Prediction field types
 */
export type PredictionFieldType =
  | 'Number'
  | 'Currency'
  | 'Percent'
  | 'Boolean'
  | 'Text'
  | 'Picklist'

/**
 * Prediction definition configuration
 */
export interface PredictionDefinition {
  /** API name of the prediction */
  developerName: string
  /** Display label */
  label: string
  /** Object to predict on */
  objectName: string
  /** Field being predicted */
  predictedField: string
  /** Type of the predicted field */
  predictedFieldType: PredictionFieldType
  /** Model type */
  modelType: PredictionModelType
  /** Whether the prediction is active */
  active: boolean
  /** Status of the model */
  status: 'Draft' | 'Training' | 'Active' | 'Inactive' | 'Failed'
  /** AI model accuracy metrics */
  accuracy?: {
    auc?: number
    f1Score?: number
    precision?: number
    recall?: number
  }
}

/**
 * Input for getting predictions
 */
export interface GetPredictionInput {
  /** Object type */
  objectType: string
  /** Record ID to get predictions for */
  recordId: string
  /** Specific prediction definition (optional) */
  predictionDefinition?: string
  /** Include explanation */
  includeExplanation?: boolean
}

/**
 * Individual prediction result
 */
export interface Prediction {
  /** Prediction definition name */
  predictionDefinition: string
  /** Predicted value */
  prediction: unknown
  /** Confidence score (0-1) */
  confidence: number
  /** Factors contributing to the prediction */
  factors?: PredictionFactor[]
  /** Timestamp of prediction */
  timestamp: string
}

/**
 * Factor contributing to a prediction
 */
export interface PredictionFactor {
  /** Field name */
  field: string
  /** Field value */
  value: unknown
  /** Impact on prediction (-1 to 1) */
  impact: number
  /** Human-readable explanation */
  explanation?: string
}

/**
 * Result from getting predictions
 */
export interface PredictionResult {
  /** Record ID */
  recordId: string
  /** Object type */
  objectType: string
  /** Predictions for this record */
  predictions: Prediction[]
  /** Request ID for tracking */
  requestId: string
}

/**
 * Input for creating a prediction definition
 */
export interface CreatePredictionInput {
  /** Developer name */
  developerName: string
  /** Display label */
  label: string
  /** Target object */
  objectName: string
  /** Field to predict */
  predictedField: string
  /** Fields to use for training */
  trainingFields?: string[]
  /** Sample size for training */
  sampleSize?: number
  /** Filter criteria for training data */
  filterCriteria?: string
}

// =============================================================================
// Next Best Action Types
// =============================================================================

/**
 * Recommendation strategy type
 */
export type RecommendationStrategyType =
  | 'External' // External model
  | 'Standard' // Salesforce standard recommendations
  | 'Custom' // Custom strategy

/**
 * Recommendation category
 */
export type RecommendationCategory =
  | 'Offer'
  | 'Action'
  | 'Information'
  | 'Engagement'
  | 'Service'
  | 'Sales'
  | 'Marketing'

/**
 * Input for getting recommendations
 */
export interface GetRecommendationsInput {
  /** Context record ID */
  contextRecordId: string
  /** Strategy name */
  strategy: string
  /** Maximum recommendations to return */
  maxResults?: number
  /** Filter by category */
  categories?: RecommendationCategory[]
  /** Additional context data */
  contextData?: Record<string, unknown>
}

/**
 * Individual recommendation
 */
export interface Recommendation {
  /** Recommendation ID */
  id: string
  /** Recommendation name */
  name: string
  /** Description */
  description?: string
  /** Category */
  category: RecommendationCategory
  /** Score/ranking */
  score: number
  /** Target URL or action */
  targetUrl?: string
  /** Action parameters */
  actionParams?: Record<string, unknown>
  /** Acceptance label */
  acceptanceLabel?: string
  /** Rejection label */
  rejectionLabel?: string
  /** Image URL */
  imageUrl?: string
  /** External ID for tracking */
  externalId?: string
}

/**
 * Result from getting recommendations
 */
export interface RecommendationResult {
  /** Context record ID */
  contextRecordId: string
  /** Strategy used */
  strategy: string
  /** Recommendations */
  recommendations: Recommendation[]
  /** Whether there are more recommendations */
  hasMore: boolean
  /** Request ID */
  requestId: string
}

/**
 * Input for accepting/rejecting a recommendation
 */
export interface RecommendationResponseInput {
  /** Recommendation ID */
  recommendationId: string
  /** Response type */
  response: 'Accepted' | 'Rejected'
  /** Context record ID */
  contextRecordId: string
  /** Additional feedback */
  feedback?: string
}

// =============================================================================
// Einstein Vision Types
// =============================================================================

/**
 * Vision model type
 */
export type VisionModelType =
  | 'ImageClassification'
  | 'ObjectDetection'
  | 'TextExtraction' // OCR
  | 'Custom'

/**
 * Input for image analysis
 */
export interface AnalyzeImageInput {
  /** Base64 encoded image or URL */
  image: string
  /** Model ID */
  modelId: string
  /** Number of results to return */
  numResults?: number
  /** Sample ID for tracking */
  sampleId?: string
}

/**
 * Image classification probability
 */
export interface ClassificationProbability {
  /** Class label */
  label: string
  /** Probability (0-1) */
  probability: number
}

/**
 * Object detection result
 */
export interface DetectedObject {
  /** Object label */
  label: string
  /** Confidence score */
  probability: number
  /** Bounding box */
  boundingBox?: {
    minX: number
    minY: number
    maxX: number
    maxY: number
  }
}

/**
 * Vision analysis result
 */
export interface VisionResult {
  /** Model ID used */
  modelId: string
  /** Classification probabilities */
  probabilities?: ClassificationProbability[]
  /** Detected objects */
  detectedObjects?: DetectedObject[]
  /** Extracted text (OCR) */
  extractedText?: string
  /** Request ID */
  requestId: string
}

/**
 * Vision dataset for training
 */
export interface VisionDataset {
  /** Dataset ID */
  id: string
  /** Dataset name */
  name: string
  /** Number of examples */
  numExamples: number
  /** Labels in the dataset */
  labels: string[]
  /** Status */
  status: 'Queued' | 'Running' | 'Succeeded' | 'Failed'
  /** Created date */
  createdDate: string
}

// =============================================================================
// Einstein Language Types
// =============================================================================

/**
 * Language model type
 */
export type LanguageModelType =
  | 'Sentiment'
  | 'Intent'
  | 'MultiLabelIntent'
  | 'Custom'

/**
 * Input for text analysis
 */
export interface AnalyzeTextInput {
  /** Text to analyze */
  text: string
  /** Model ID */
  modelId: string
  /** Number of results */
  numResults?: number
  /** Sample ID for tracking */
  sampleId?: string
}

/**
 * Sentiment result
 */
export interface SentimentResult {
  /** Sentiment label */
  sentiment: 'Positive' | 'Negative' | 'Neutral'
  /** Confidence */
  probability: number
}

/**
 * Intent classification result
 */
export interface IntentResult {
  /** Intent label */
  label: string
  /** Probability */
  probability: number
}

/**
 * Language analysis result
 */
export interface LanguageResult {
  /** Model ID used */
  modelId: string
  /** Sentiment (if sentiment model) */
  sentiment?: SentimentResult
  /** Intents (if intent model) */
  intents?: IntentResult[]
  /** Request ID */
  requestId: string
}

// =============================================================================
// Einstein GPT Types (Generative AI)
// =============================================================================

/**
 * GPT model configuration
 */
export type EinsteinGPTModel =
  | 'salesforce-gpt'
  | 'salesforce-codegen'
  | 'openai-gpt-4'
  | 'anthropic-claude'
  | 'custom'

/**
 * GPT use case type
 */
export type GPTUseCase =
  | 'EmailGeneration'
  | 'ServiceReply'
  | 'RecordSummary'
  | 'CodeGeneration'
  | 'ContentGeneration'
  | 'FieldGeneration'
  | 'Custom'

/**
 * Input for GPT generation
 */
export interface GenerateInput {
  /** Prompt text */
  prompt: string
  /** Model to use */
  model?: EinsteinGPTModel
  /** Use case */
  useCase?: GPTUseCase
  /** Context data */
  context?: {
    /** Related record ID */
    recordId?: string
    /** Object type */
    objectType?: string
    /** Additional context fields */
    fields?: Record<string, unknown>
  }
  /** Generation parameters */
  parameters?: {
    /** Temperature (0-1) */
    temperature?: number
    /** Max tokens */
    maxTokens?: number
    /** Top P */
    topP?: number
    /** Stop sequences */
    stopSequences?: string[]
  }
  /** Ground the response in CRM data */
  groundTruth?: boolean
}

/**
 * GPT generation result
 */
export interface GenerateResult {
  /** Generated text */
  text: string
  /** Tokens used */
  tokensUsed?: number
  /** Model used */
  model: string
  /** Whether response was grounded */
  grounded: boolean
  /** Citations from CRM data */
  citations?: Citation[]
  /** Content safety flags */
  safetyFlags?: SafetyFlag[]
  /** Request ID */
  requestId: string
}

/**
 * Citation from CRM data
 */
export interface Citation {
  /** Source record ID */
  recordId: string
  /** Object type */
  objectType: string
  /** Cited field */
  field: string
  /** Cited text snippet */
  snippet: string
}

/**
 * Safety flag for content moderation
 */
export interface SafetyFlag {
  /** Flag type */
  type: 'toxic' | 'sensitive' | 'pii' | 'copyright' | 'bias'
  /** Severity */
  severity: 'low' | 'medium' | 'high'
  /** Description */
  description: string
}

// =============================================================================
// Einstein Bot Types
// =============================================================================

/**
 * Bot configuration
 */
export interface BotConfig {
  /** Bot ID */
  id: string
  /** Bot name */
  name: string
  /** Language */
  language: string
  /** Version */
  version: string
  /** Active status */
  active: boolean
  /** NLU model */
  nluModel?: string
}

/**
 * Input for sending a message to a bot
 */
export interface BotMessageInput {
  /** Bot ID */
  botId: string
  /** Session ID */
  sessionId: string
  /** Message text */
  text: string
  /** Context variables */
  variables?: Record<string, unknown>
  /** Channel */
  channel?: 'Web' | 'SMS' | 'WhatsApp' | 'Slack' | 'Custom'
}

/**
 * Bot response message
 */
export interface BotMessage {
  /** Message type */
  type: 'Text' | 'Card' | 'QuickReply' | 'Transfer' | 'End'
  /** Message text */
  text?: string
  /** Quick reply options */
  quickReplies?: string[]
  /** Card data */
  card?: {
    title: string
    subtitle?: string
    imageUrl?: string
    buttons?: Array<{
      label: string
      value: string
      type: 'postback' | 'url'
    }>
  }
  /** Transfer data */
  transfer?: {
    skillId?: string
    reason?: string
    context?: Record<string, unknown>
  }
}

/**
 * Bot message result
 */
export interface BotMessageResult {
  /** Session ID */
  sessionId: string
  /** Bot messages */
  messages: BotMessage[]
  /** Updated variables */
  variables?: Record<string, unknown>
  /** Intent detected */
  intent?: {
    name: string
    confidence: number
  }
  /** Entities extracted */
  entities?: Array<{
    name: string
    value: unknown
    confidence: number
  }>
  /** Request ID */
  requestId: string
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Einstein error types
 */
export type EinsteinErrorCode =
  | 'INVALID_REQUEST'
  | 'AUTHENTICATION_ERROR'
  | 'RATE_LIMITED'
  | 'MODEL_NOT_FOUND'
  | 'PREDICTION_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'CONTENT_SAFETY'
  | 'QUOTA_EXCEEDED'
  | 'FEATURE_NOT_ENABLED'

/**
 * Einstein API Error
 */
export class EinsteinError extends Error {
  code: EinsteinErrorCode
  statusCode: number
  requestId?: string
  details?: Record<string, unknown>

  constructor(
    code: EinsteinErrorCode,
    message: string,
    statusCode: number,
    requestId?: string,
    details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'EinsteinError'
    this.code = code
    this.statusCode = statusCode
    this.requestId = requestId
    this.details = details
  }
}

// =============================================================================
// Einstein Predictions Service
// =============================================================================

/**
 * Einstein Predictions API handler
 */
export class EinsteinPredictions {
  private conn: Connection
  private hooks: EinsteinHooks

  constructor(conn: Connection, hooks: EinsteinHooks = {}) {
    this.conn = conn
    this.hooks = hooks
  }

  /**
   * Get all prediction definitions
   */
  async listPredictionDefinitions(objectName?: string): Promise<PredictionDefinition[]> {
    const query = objectName
      ? `SELECT Id, DeveloperName, MasterLabel, Object__c, PredictedField__c, Status__c FROM PredictionDefinition WHERE Object__c = '${objectName}'`
      : 'SELECT Id, DeveloperName, MasterLabel, Object__c, PredictedField__c, Status__c FROM PredictionDefinition'

    try {
      const result = await this.conn.query<{
        DeveloperName: string
        MasterLabel: string
        Object__c: string
        PredictedField__c: string
        Status__c: string
      }>(query)

      return result.records.map((r) => ({
        developerName: r.DeveloperName,
        label: r.MasterLabel,
        objectName: r.Object__c,
        predictedField: r.PredictedField__c,
        predictedFieldType: 'Boolean' as PredictionFieldType,
        modelType: 'PredictionDefinition' as PredictionModelType,
        active: r.Status__c === 'Active',
        status: r.Status__c as PredictionDefinition['status'],
      }))
    } catch {
      // Return empty if feature not enabled
      return []
    }
  }

  /**
   * Get predictions for a record
   */
  async getPredictions(input: GetPredictionInput): Promise<PredictionResult> {
    const execute = async (inp: GetPredictionInput): Promise<PredictionResult> => {
      const { objectType, recordId, predictionDefinition, includeExplanation } = inp

      const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/smartdatadiscovery/predict`

      const body: Record<string, unknown> = {
        objectApiName: objectType,
        recordId,
      }

      if (predictionDefinition) {
        body.predictionDefinition = predictionDefinition
      }
      if (includeExplanation) {
        body.includeExplanation = true
      }

      const response = await this.conn._request<{
        predictions: Array<{
          predictionDefinition: string
          prediction: unknown
          confidence: number
          factors?: Array<{
            field: string
            value: unknown
            impact: number
            explanation?: string
          }>
          timestamp: string
        }>
        requestId: string
      }>('POST', url, body)

      return {
        recordId,
        objectType,
        predictions: response.predictions.map((p) => ({
          predictionDefinition: p.predictionDefinition,
          prediction: p.prediction,
          confidence: p.confidence,
          factors: p.factors,
          timestamp: p.timestamp,
        })),
        requestId: response.requestId,
      }
    }

    // Apply hooks
    if (this.hooks.beforeGetPrediction) {
      return this.hooks.beforeGetPrediction(input, execute)
    }

    let result = await execute(input)

    if (this.hooks.afterGetPrediction) {
      result = await this.hooks.afterGetPrediction(result)
    }

    return result
  }

  /**
   * Create a prediction definition
   */
  async createPredictionDefinition(input: CreatePredictionInput): Promise<{ id: string; status: string }> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/tooling/sobjects/PredictionDefinition`

    const body = {
      DeveloperName: input.developerName,
      MasterLabel: input.label,
      Object__c: input.objectName,
      PredictedField__c: input.predictedField,
      TrainingFields__c: input.trainingFields?.join(','),
      SampleSize__c: input.sampleSize || 100000,
      FilterCriteria__c: input.filterCriteria,
    }

    const result = await this.conn._request<{ id: string }>('POST', url, body)
    return { id: result.id, status: 'Draft' }
  }

  /**
   * Activate a prediction definition
   */
  async activatePrediction(predictionDefinitionId: string): Promise<{ success: boolean }> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/tooling/sobjects/PredictionDefinition/${predictionDefinitionId}`

    await this.conn._request<null>('PATCH', url, { Status__c: 'Active' })
    return { success: true }
  }

  /**
   * Deactivate a prediction definition
   */
  async deactivatePrediction(predictionDefinitionId: string): Promise<{ success: boolean }> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/tooling/sobjects/PredictionDefinition/${predictionDefinitionId}`

    await this.conn._request<null>('PATCH', url, { Status__c: 'Inactive' })
    return { success: true }
  }
}

// =============================================================================
// Einstein Next Best Action Service
// =============================================================================

/**
 * Einstein Next Best Action API handler
 */
export class EinsteinNextBestAction {
  private conn: Connection
  private hooks: EinsteinHooks

  constructor(conn: Connection, hooks: EinsteinHooks = {}) {
    this.conn = conn
    this.hooks = hooks
  }

  /**
   * Get recommendations for a record
   */
  async getRecommendations(input: GetRecommendationsInput): Promise<RecommendationResult> {
    const execute = async (inp: GetRecommendationsInput): Promise<RecommendationResult> => {
      const { contextRecordId, strategy, maxResults, categories, contextData } = inp

      const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/connect/recommendation-strategies/${strategy}/recommendations`

      const params = new URLSearchParams({
        contextRecordId,
      })

      if (maxResults) {
        params.set('maxResults', String(maxResults))
      }

      const response = await this.conn._request<{
        recommendations: Array<{
          id: string
          name: string
          description?: string
          category: RecommendationCategory
          score: number
          targetUrl?: string
          actionParameters?: Record<string, unknown>
          acceptanceLabel?: string
          rejectionLabel?: string
          imageUrl?: string
          externalId?: string
        }>
        hasMore: boolean
        requestId: string
      }>('GET', `${url}?${params.toString()}`)

      let recommendations = response.recommendations.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        category: r.category,
        score: r.score,
        targetUrl: r.targetUrl,
        actionParams: r.actionParameters,
        acceptanceLabel: r.acceptanceLabel,
        rejectionLabel: r.rejectionLabel,
        imageUrl: r.imageUrl,
        externalId: r.externalId,
      }))

      // Filter by categories if specified
      if (categories?.length) {
        recommendations = recommendations.filter((r) => categories.includes(r.category))
      }

      return {
        contextRecordId,
        strategy,
        recommendations,
        hasMore: response.hasMore,
        requestId: response.requestId,
      }
    }

    // Apply hooks
    if (this.hooks.beforeGetRecommendations) {
      return this.hooks.beforeGetRecommendations(input, execute)
    }

    let result = await execute(input)

    if (this.hooks.afterGetRecommendations) {
      result = await this.hooks.afterGetRecommendations(result)
    }

    return result
  }

  /**
   * Record a response to a recommendation
   */
  async recordResponse(input: RecommendationResponseInput): Promise<{ success: boolean }> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/connect/recommendation-strategies/recommendations/${input.recommendationId}/responses`

    await this.conn._request<null>('POST', url, {
      response: input.response,
      contextRecordId: input.contextRecordId,
      feedback: input.feedback,
    })

    return { success: true }
  }

  /**
   * List available strategies
   */
  async listStrategies(): Promise<Array<{ name: string; description?: string; type: RecommendationStrategyType }>> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/connect/recommendation-strategies`

    const response = await this.conn._request<{
      strategies: Array<{
        name: string
        description?: string
        type: RecommendationStrategyType
      }>
    }>('GET', url)

    return response.strategies
  }
}

// =============================================================================
// Einstein Vision Service
// =============================================================================

/**
 * Einstein Vision API handler
 */
export class EinsteinVision {
  private conn: Connection
  private hooks: EinsteinHooks

  constructor(conn: Connection, hooks: EinsteinHooks = {}) {
    this.conn = conn
    this.hooks = hooks
  }

  /**
   * Analyze an image
   */
  async analyzeImage(input: AnalyzeImageInput): Promise<VisionResult> {
    const execute = async (inp: AnalyzeImageInput): Promise<VisionResult> => {
      const { image, modelId, numResults, sampleId } = inp

      const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/einstein/vision/predict`

      const body: Record<string, unknown> = {
        modelId,
        numResults: numResults || 3,
      }

      // Check if image is URL or base64
      if (image.startsWith('http://') || image.startsWith('https://')) {
        body.sampleLocation = image
      } else {
        body.sampleBase64Content = image
      }

      if (sampleId) {
        body.sampleId = sampleId
      }

      const response = await this.conn._request<{
        probabilities?: Array<{
          label: string
          probability: number
        }>
        detectedObjects?: Array<{
          label: string
          probability: number
          boundingBox?: {
            minX: number
            minY: number
            maxX: number
            maxY: number
          }
        }>
        ocrResult?: string
        requestId: string
      }>('POST', url, body)

      return {
        modelId,
        probabilities: response.probabilities,
        detectedObjects: response.detectedObjects,
        extractedText: response.ocrResult,
        requestId: response.requestId,
      }
    }

    // Apply hooks
    if (this.hooks.beforeAnalyzeImage) {
      return this.hooks.beforeAnalyzeImage(input, execute)
    }

    let result = await execute(input)

    if (this.hooks.afterAnalyzeImage) {
      result = await this.hooks.afterAnalyzeImage(result)
    }

    return result
  }

  /**
   * List available vision models
   */
  async listModels(): Promise<Array<{ id: string; name: string; type: VisionModelType; status: string }>> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/einstein/vision/models`

    const response = await this.conn._request<{
      models: Array<{
        id: string
        name: string
        type: VisionModelType
        status: string
      }>
    }>('GET', url)

    return response.models
  }

  /**
   * Create a dataset for training
   */
  async createDataset(name: string, labels: string[]): Promise<VisionDataset> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/einstein/vision/datasets`

    const response = await this.conn._request<{
      id: string
      name: string
      numExamples: number
      labels: string[]
      status: string
      createdDate: string
    }>('POST', url, { name, labels })

    return {
      id: response.id,
      name: response.name,
      numExamples: response.numExamples,
      labels: response.labels,
      status: response.status as VisionDataset['status'],
      createdDate: response.createdDate,
    }
  }

  /**
   * Train a model from a dataset
   */
  async trainModel(datasetId: string, name: string): Promise<{ modelId: string; status: string }> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/einstein/vision/train`

    const response = await this.conn._request<{
      modelId: string
      status: string
    }>('POST', url, { datasetId, name })

    return response
  }
}

// =============================================================================
// Einstein Language Service
// =============================================================================

/**
 * Einstein Language API handler
 */
export class EinsteinLanguage {
  private conn: Connection
  private hooks: EinsteinHooks

  constructor(conn: Connection, hooks: EinsteinHooks = {}) {
    this.conn = conn
    this.hooks = hooks
  }

  /**
   * Analyze text using a language model
   */
  async analyzeText(input: AnalyzeTextInput): Promise<LanguageResult> {
    const execute = async (inp: AnalyzeTextInput): Promise<LanguageResult> => {
      const { text, modelId, numResults } = inp

      const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/einstein/language/predict`

      const response = await this.conn._request<{
        probabilities?: Array<{
          label: string
          probability: number
        }>
        sentiment?: {
          sentiment: 'Positive' | 'Negative' | 'Neutral'
          probability: number
        }
        requestId: string
      }>('POST', url, {
        modelId,
        document: text,
        numResults: numResults || 3,
      })

      return {
        modelId,
        sentiment: response.sentiment,
        intents: response.probabilities?.map((p) => ({
          label: p.label,
          probability: p.probability,
        })),
        requestId: response.requestId,
      }
    }

    // Apply hooks
    if (this.hooks.beforeAnalyzeText) {
      return this.hooks.beforeAnalyzeText(input, execute)
    }

    let result = await execute(input)

    if (this.hooks.afterAnalyzeText) {
      result = await this.hooks.afterAnalyzeText(result)
    }

    return result
  }

  /**
   * Detect sentiment in text
   */
  async detectSentiment(text: string): Promise<SentimentResult> {
    const result = await this.analyzeText({
      text,
      modelId: 'CommunitySentiment', // Built-in sentiment model
    })

    return result.sentiment || { sentiment: 'Neutral', probability: 0.5 }
  }

  /**
   * Detect intent in text
   */
  async detectIntent(text: string, modelId: string): Promise<IntentResult[]> {
    const result = await this.analyzeText({ text, modelId })
    return result.intents || []
  }

  /**
   * List available language models
   */
  async listModels(): Promise<Array<{ id: string; name: string; type: LanguageModelType; status: string }>> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/einstein/language/models`

    const response = await this.conn._request<{
      models: Array<{
        id: string
        name: string
        type: LanguageModelType
        status: string
      }>
    }>('GET', url)

    return response.models
  }
}

// =============================================================================
// Einstein GPT Service
// =============================================================================

/**
 * Einstein GPT (Generative AI) API handler
 */
export class EinsteinGPT {
  private conn: Connection
  private hooks: EinsteinHooks

  constructor(conn: Connection, hooks: EinsteinHooks = {}) {
    this.conn = conn
    this.hooks = hooks
  }

  /**
   * Generate text using Einstein GPT
   */
  async generate(input: GenerateInput): Promise<GenerateResult> {
    const execute = async (inp: GenerateInput): Promise<GenerateResult> => {
      const { prompt, model, useCase, context, parameters, groundTruth } = inp

      const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/einstein/llm/prompt/generations`

      const body: Record<string, unknown> = {
        promptTextorTemplate: prompt,
        provider: model || 'salesforce-gpt',
      }

      if (useCase) {
        body.additionalConfig = { useCase }
      }

      if (context?.recordId) {
        body.inputParams = {
          'Input:Record': `${context.objectType || 'Record'}:${context.recordId}`,
          ...(context.fields || {}),
        }
      }

      if (parameters) {
        body.providerConfig = {
          temperature: parameters.temperature ?? 0.7,
          maxTokens: parameters.maxTokens ?? 512,
          topP: parameters.topP ?? 1.0,
          stopSequences: parameters.stopSequences,
        }
      }

      if (groundTruth !== undefined) {
        body.enableGrounding = groundTruth
      }

      const response = await this.conn._request<{
        generation: {
          generatedText: string
          tokensUsed?: number
        }
        grounded: boolean
        citations?: Array<{
          recordId: string
          objectType: string
          field: string
          snippet: string
        }>
        safetyFlags?: Array<{
          type: SafetyFlag['type']
          severity: SafetyFlag['severity']
          description: string
        }>
        requestId: string
      }>('POST', url, body)

      return {
        text: response.generation.generatedText,
        tokensUsed: response.generation.tokensUsed,
        model: model || 'salesforce-gpt',
        grounded: response.grounded,
        citations: response.citations,
        safetyFlags: response.safetyFlags,
        requestId: response.requestId,
      }
    }

    // Apply hooks
    if (this.hooks.beforeGenerate) {
      return this.hooks.beforeGenerate(input, execute)
    }

    let result = await execute(input)

    if (this.hooks.afterGenerate) {
      result = await this.hooks.afterGenerate(result)
    }

    return result
  }

  /**
   * Generate an email using Einstein GPT
   */
  async generateEmail(options: {
    context: { recordId: string; objectType: string }
    tone?: 'formal' | 'casual' | 'professional'
    intent?: string
  }): Promise<GenerateResult> {
    return this.generate({
      prompt: options.intent
        ? `Write a ${options.tone || 'professional'} email with the intent: ${options.intent}`
        : `Write a ${options.tone || 'professional'} email for this context`,
      useCase: 'EmailGeneration',
      context: options.context,
      groundTruth: true,
    })
  }

  /**
   * Generate a record summary
   */
  async summarizeRecord(recordId: string, objectType: string): Promise<GenerateResult> {
    return this.generate({
      prompt: `Summarize the key information about this ${objectType} record`,
      useCase: 'RecordSummary',
      context: { recordId, objectType },
      groundTruth: true,
    })
  }

  /**
   * Generate a service reply
   */
  async generateServiceReply(caseId: string, customerMessage: string): Promise<GenerateResult> {
    return this.generate({
      prompt: `Generate a helpful customer service reply to: "${customerMessage}"`,
      useCase: 'ServiceReply',
      context: { recordId: caseId, objectType: 'Case' },
      groundTruth: true,
    })
  }
}

// =============================================================================
// Einstein Bots Service
// =============================================================================

/**
 * Einstein Bots API handler
 */
export class EinsteinBots {
  private conn: Connection
  private hooks: EinsteinHooks

  constructor(conn: Connection, hooks: EinsteinHooks = {}) {
    this.conn = conn
    this.hooks = hooks
  }

  /**
   * List available bots
   */
  async listBots(): Promise<BotConfig[]> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/connect/chatbots`

    const response = await this.conn._request<{
      bots: Array<{
        id: string
        name: string
        language: string
        version: string
        status: string
        nluModel?: string
      }>
    }>('GET', url)

    return response.bots.map((b) => ({
      id: b.id,
      name: b.name,
      language: b.language,
      version: b.version,
      active: b.status === 'Active',
      nluModel: b.nluModel,
    }))
  }

  /**
   * Start a new bot session
   */
  async startSession(botId: string, channel?: BotMessageInput['channel']): Promise<{ sessionId: string }> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/connect/chatbots/${botId}/sessions`

    const response = await this.conn._request<{ sessionId: string }>('POST', url, {
      channel: channel || 'Web',
    })

    return response
  }

  /**
   * Send a message to a bot
   */
  async sendMessage(input: BotMessageInput): Promise<BotMessageResult> {
    const execute = async (inp: BotMessageInput): Promise<BotMessageResult> => {
      const { botId, sessionId, text, variables } = inp

      const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/connect/chatbots/${botId}/sessions/${sessionId}/messages`

      const response = await this.conn._request<{
        messages: Array<{
          type: BotMessage['type']
          text?: string
          quickReplies?: string[]
          card?: BotMessage['card']
          transfer?: BotMessage['transfer']
        }>
        variables?: Record<string, unknown>
        intent?: {
          name: string
          confidence: number
        }
        entities?: Array<{
          name: string
          value: unknown
          confidence: number
        }>
        requestId: string
      }>('POST', url, {
        text,
        variables,
      })

      return {
        sessionId,
        messages: response.messages,
        variables: response.variables,
        intent: response.intent,
        entities: response.entities,
        requestId: response.requestId,
      }
    }

    // Apply hooks
    if (this.hooks.beforeSendMessage) {
      return this.hooks.beforeSendMessage(input, execute)
    }

    let result = await execute(input)

    if (this.hooks.afterSendMessage) {
      result = await this.hooks.afterSendMessage(result)
    }

    return result
  }

  /**
   * End a bot session
   */
  async endSession(botId: string, sessionId: string): Promise<{ success: boolean }> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/connect/chatbots/${botId}/sessions/${sessionId}`

    await this.conn._request<null>('DELETE', url)
    return { success: true }
  }
}

// =============================================================================
// Main Einstein Client
// =============================================================================

/**
 * Einstein AI configuration
 */
export interface EinsteinConfig {
  /** Custom hooks for intercepting operations */
  hooks?: EinsteinHooks
  /** Enable debug logging */
  debug?: boolean
}

/**
 * Main Einstein AI client
 */
export class Einstein {
  readonly predictions: EinsteinPredictions
  readonly nextBestAction: EinsteinNextBestAction
  readonly vision: EinsteinVision
  readonly language: EinsteinLanguage
  readonly gpt: EinsteinGPT
  readonly bots: EinsteinBots

  private conn: Connection
  private config: EinsteinConfig

  constructor(conn: Connection, config: EinsteinConfig = {}) {
    this.conn = conn
    this.config = config

    const hooks = config.hooks || {}

    this.predictions = new EinsteinPredictions(conn, hooks)
    this.nextBestAction = new EinsteinNextBestAction(conn, hooks)
    this.vision = new EinsteinVision(conn, hooks)
    this.language = new EinsteinLanguage(conn, hooks)
    this.gpt = new EinsteinGPT(conn, hooks)
    this.bots = new EinsteinBots(conn, hooks)
  }

  /**
   * Check if Einstein AI features are enabled for this org
   */
  async checkFeatures(): Promise<{
    predictions: boolean
    nextBestAction: boolean
    vision: boolean
    language: boolean
    gpt: boolean
    bots: boolean
  }> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/limits`

    try {
      const limits = await this.conn._request<Record<string, unknown>>('GET', url)

      return {
        predictions: 'EinsteinPredictions' in limits,
        nextBestAction: 'EinsteinNextBestAction' in limits,
        vision: 'EinsteinVision' in limits,
        language: 'EinsteinLanguage' in limits,
        gpt: 'EinsteinGPT' in limits,
        bots: 'EinsteinBots' in limits,
      }
    } catch {
      return {
        predictions: false,
        nextBestAction: false,
        vision: false,
        language: false,
        gpt: false,
        bots: false,
      }
    }
  }

  /**
   * Update hooks
   */
  setHooks(hooks: EinsteinHooks): void {
    Object.assign(this.predictions['hooks'], hooks)
    Object.assign(this.nextBestAction['hooks'], hooks)
    Object.assign(this.vision['hooks'], hooks)
    Object.assign(this.language['hooks'], hooks)
    Object.assign(this.gpt['hooks'], hooks)
    Object.assign(this.bots['hooks'], hooks)
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an Einstein client from a Salesforce connection
 */
export function createEinstein(conn: Connection, config?: EinsteinConfig): Einstein {
  return new Einstein(conn, config)
}

/**
 * Create a prediction hook that logs all predictions
 */
export function createLoggingHook(): EinsteinHooks {
  return {
    afterGetPrediction: async (result) => {
      console.log(`[Einstein] Prediction for ${result.objectType}/${result.recordId}:`, result.predictions)
      return result
    },
    afterGetRecommendations: async (result) => {
      console.log(`[Einstein] Recommendations for ${result.contextRecordId}:`, result.recommendations)
      return result
    },
    afterGenerate: async (result) => {
      console.log(`[Einstein] Generated (${result.model}):`, result.text.substring(0, 100))
      return result
    },
    onError: async (error, operation) => {
      console.error(`[Einstein] Error in ${operation}:`, error.message)
    },
  }
}

/**
 * Create a caching hook for predictions
 */
export function createCachingHook(cache: Map<string, PredictionResult>): EinsteinHooks {
  return {
    beforeGetPrediction: async (input, next) => {
      const cacheKey = `${input.objectType}:${input.recordId}:${input.predictionDefinition || 'all'}`
      const cached = cache.get(cacheKey)

      if (cached) {
        return cached
      }

      const result = await next(input)
      cache.set(cacheKey, result)
      return result
    },
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default Einstein
