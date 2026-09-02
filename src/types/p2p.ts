// P2P marketplace types

export type P2PSide = 'buy' | 'sell';
export type P2PAdStatus = 'active' | 'inactive' | 'completed' | 'deleted';
export type P2POrderStatus =
  | 'pending'
  | 'paid'
  | 'released'
  | 'cancelled'
  | 'disputed'
  | 'appeal_in_progress'
  | 'completed';

export interface P2PAd {
  id: string;
  merchantId?: string;
  merchantName: string;
  completionRate: number;
  tradeCount: number;
  price: number;
  available: number;
  minLimit: number;
  maxLimit: number;
  paymentMethods: string[];
  asset: string;
  fiat: string;
  side: P2PSide;
  isOnline: boolean;
  status?: P2PAdStatus;
  currency?: string;
  remarks?: string;
  autoReply?: string;
  avgReleaseTime?: number; // minutes
  createdAt?: string;
}

export interface P2POrder {
  id: string;
  adId: string;
  buyerId: string;
  sellerId: string;
  asset: string;
  fiat: string;
  amount: number;       // crypto amount
  fiatAmount: number;
  price: number;
  paymentMethod: string;
  status: P2POrderStatus;
  paymentProof?: string;
  disputeReason?: string;
  escrowTxId?: string;
  createdAt: string;
  expiresAt?: string;
  paidAt?: string;
  releasedAt?: string;
}

export interface P2PMessage {
  id: string;
  orderId: string;
  senderId: string;
  senderName?: string;
  content: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'document';
  isSystemMessage?: boolean;
  readAt?: string;
  createdAt: string;
}

export interface P2PDispute {
  id: string;
  orderId: string;
  raisedBy: string;
  reason: string;
  evidenceUrls?: string[];
  status: 'open' | 'under_review' | 'resolved_buyer' | 'resolved_seller' | 'cancelled';
  adminNote?: string;
  resolvedAt?: string;
  createdAt: string;
}

export interface Merchant {
  id: string;
  userId: string;
  displayName: string;
  completionRate: number;
  totalTrades: number;
  positiveRatings: number;
  negativeRatings: number;
  avgReleaseTime: number; // minutes
  isOnline: boolean;
  isCertified: boolean;
  joinedAt: string;
}
