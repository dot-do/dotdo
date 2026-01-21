// Marketplace Escrow Example - Type definitions

export type EscrowStatus =
  | 'pending'
  | 'funded'
  | 'delivered'
  | 'released'
  | 'disputed'
  | 'resolved'
  | 'cancelled'
  | 'refunded'

export interface Escrow {
  $type: 'Escrow'
  buyerId: string
  sellerId: string
  amount: number
  currency: string
  itemDescription: string
  status: EscrowStatus
  arbiter: string
  inspectionDeadline: string
  deliveryDeadline: string
  fundedAt?: string
  deliveredAt?: string
  releasedAt?: string
  cancelledAt?: string
  trackingNumber?: string
  carrier?: string
}

export interface Dispute {
  $type: 'Dispute'
  escrowId: string
  buyerId: string
  sellerId: string
  reason: DisputeReason
  description: string
  status: DisputeStatus
  evidence: Evidence[]
  resolution?: DisputeResolution
  escalatedTo?: string
  evidenceDeadline: string
  resolutionDeadline: string
  createdAt: string
  resolvedAt?: string
}

export type DisputeReason =
  | 'ITEM_NOT_RECEIVED'
  | 'ITEM_NOT_AS_DESCRIBED'
  | 'ITEM_DAMAGED'
  | 'WRONG_ITEM'
  | 'COUNTERFEIT'
  | 'OTHER'

export type DisputeStatus =
  | 'open'
  | 'evidence_period'
  | 'under_review'
  | 'resolved'
  | 'escalated'

export interface Evidence {
  id: string
  type: 'photo' | 'video' | 'document' | 'message' | 'tracking' | 'screenshot'
  url: string
  description: string
  submittedBy: 'buyer' | 'seller'
  submittedAt: string
}

export interface DisputeResolution {
  decision: 'FULL_REFUND' | 'PARTIAL_REFUND' | 'RELEASE_TO_SELLER' | 'SPLIT'
  buyerAmount: number
  sellerAmount: number
  notes: string
  resolvedBy: string
  resolvedAt: string
}

export interface Order {
  $type: 'Order'
  escrowId: string
  buyerId: string
  sellerId: string
  itemDescription: string
  trackingNumber?: string
  carrier?: string
  deliveryStatus: 'pending' | 'shipped' | 'in_transit' | 'delivered'
  shippedAt?: string
  deliveredAt?: string
}

export interface FeeCalculation {
  subtotal: number
  platformFee: number
  escrowFee: number
  totalFees: number
  sellerReceives: number
}

export interface User {
  $type: 'User'
  role: 'buyer' | 'seller' | 'arbiter'
  email: string
  name: string
}
