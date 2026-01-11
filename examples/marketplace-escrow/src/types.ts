/**
 * Marketplace Escrow - Type Definitions
 *
 * Shared types used across all Durable Objects and API routes.
 */

// ============================================================================
// ESCROW TYPES
// ============================================================================

export type EscrowStatus =
  | 'pending' // Created, awaiting funding
  | 'funded' // Buyer has funded, awaiting delivery
  | 'delivered' // Seller marked delivered, inspection period active
  | 'released' // Funds released to seller
  | 'disputed' // Dispute opened, awaiting resolution
  | 'resolved' // Dispute resolved, funds distributed
  | 'refunded' // Funds returned to buyer
  | 'cancelled' // Cancelled before completion

export interface Escrow {
  id: string
  buyer: string
  seller: string
  arbiter: string
  amount: number
  currency: string
  itemDescription: string
  status: EscrowStatus
  inspectionDays: number
  deliveryDays: number
  createdAt: string
  updatedAt: string
  fundedAt?: string
  deliveredAt?: string
  releasedAt?: string
  disputedAt?: string
  resolvedAt?: string
  refundedAt?: string
  cancelledAt?: string
  tracking?: TrackingInfo
  inspectionDeadline?: string
  deliveryDeadline?: string
  disputeId?: string
  timeline: TimelineEvent[]
}

export interface TrackingInfo {
  carrier: string
  trackingNumber: string
  estimatedDelivery?: string
}

export interface TimelineEvent {
  event: string
  timestamp: string
  actor?: string
  details?: Record<string, unknown>
}

export interface FeeDistribution {
  total: number
  platformFee: number
  platformFeePercent: number
  escrowFee: number
  escrowFeePercent: number
  sellerReceives: number
}

// ============================================================================
// REQUEST/RESPONSE TYPES
// ============================================================================

export interface CreateEscrowRequest {
  buyer: string
  seller: string
  amount: number
  currency?: string
  itemDescription: string
  arbiter?: string
  inspectionDays?: number
  deliveryDays?: number
}

export interface FundEscrowRequest {
  paymentMethod: {
    type: 'card' | 'bank' | 'crypto'
    token: string
  }
}

export interface DeliverRequest {
  trackingNumber: string
  carrier: string
  estimatedDelivery?: string
}

export interface DisputeRequest {
  reason: DisputeReason
  description: string
  evidence?: Array<{
    type: EvidenceType
    url: string
    description: string
  }>
}

export interface ResolveRequest {
  decision: ResolutionDecision
  buyerAmount: number
  sellerAmount: number
  notes: string
}

// ============================================================================
// DISPUTE TYPES
// ============================================================================

export type DisputeReason =
  | 'ITEM_NOT_RECEIVED'
  | 'ITEM_NOT_AS_DESCRIBED'
  | 'ITEM_DAMAGED'
  | 'WRONG_ITEM'
  | 'COUNTERFEIT'
  | 'SELLER_NON_DELIVERY'
  | 'BUYER_NON_PAYMENT'
  | 'OTHER'

export type EvidenceType = 'photo' | 'video' | 'document' | 'message' | 'tracking' | 'screenshot'

export type ResolutionDecision =
  | 'FULL_REFUND' // 100% to buyer
  | 'PARTIAL_REFUND' // Split between buyer and seller
  | 'RELEASE_TO_SELLER' // 100% to seller
  | 'SPLIT' // 50/50 split

export interface Evidence {
  id: string
  type: EvidenceType
  url: string
  description: string
  submittedBy: 'buyer' | 'seller'
  submittedAt: string
}

export interface Dispute {
  id: string
  escrowId: string
  orderId?: string
  buyer: string
  seller: string
  arbiter: string
  amount: number
  reason: DisputeReason
  description: string
  status: DisputeStatus
  openedBy: 'buyer' | 'seller'
  buyerEvidence: Evidence[]
  sellerEvidence: Evidence[]
  sellerResponse?: string
  sellerRespondedAt?: string
  resolution?: Resolution
  evidenceDeadline: string
  escalationDeadline?: string
  timeline: TimelineEvent[]
  createdAt: string
  updatedAt: string
}

export type DisputeStatus =
  | 'opened'
  | 'evidence_period'
  | 'under_review'
  | 'escalated'
  | 'resolved'

export interface Resolution {
  id: string
  decision: ResolutionDecision
  buyerAmount: number
  sellerAmount: number
  notes: string
  resolvedBy: string
  resolvedAt: string
}

// ============================================================================
// ORDER TYPES
// ============================================================================

export type OrderStatus =
  | 'pending'
  | 'shipped'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'delivery_failed'
  | 'returned'

export interface Order {
  id: string
  escrowId: string
  buyer: string
  seller: string
  itemDescription: string
  shippingAddress?: ShippingAddress
  tracking?: TrackingInfo
  status: OrderStatus
  deliveredAt?: string
  signedBy?: string
  proofOfDelivery?: string
  timeline: TimelineEvent[]
  createdAt: string
  updatedAt: string
}

export interface ShippingAddress {
  name: string
  street: string
  city: string
  state: string
  zip: string
  country: string
  phone?: string
}

// ============================================================================
// ENV TYPES
// ============================================================================

export interface Env {
  ESCROW: DurableObjectNamespace
  ORDER: DurableObjectNamespace
  DISPUTE: DurableObjectNamespace
  PLATFORM_FEE_PERCENT: string
  DEFAULT_INSPECTION_DAYS: string
  DEFAULT_DELIVERY_DAYS: string
}
