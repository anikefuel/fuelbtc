// User, profile, KYC, and settings types

export type UserRole = 'user' | 'admin' | 'support' | 'compliance' | 'finance';
export type KycTier = 'tier0' | 'tier1' | 'tier2' | 'tier3';
export type KycStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface UserProfile {
  id: string;
  email: string;
  username?: string;
  role: UserRole;
  avatarUrl?: string;
  uid: string;
  vipLevel: number;
  referralCode: string;
  referredBy?: string;
  kycTier: KycTier;
  kycStatus: KycStatus;
  isFrozen: boolean;
  antiPhishingCode?: string;
  twoFaEnabled: boolean;
  preferredCurrency: string; // e.g. "USD"
  preferredLanguage: string; // e.g. "en"
  theme: 'dark' | 'light' | 'system';
  createdAt: string;
  updatedAt: string;
}

export interface KycTierInfo {
  tier: number;
  label: string;
  status: 'completed' | 'pending' | 'locked' | 'rejected';
  items: string[];
  limit: string;
  dailyWithdrawalUsd: number;
}

export interface UserDevice {
  id: string;
  userId: string;
  deviceName: string;
  deviceType: 'mobile' | 'tablet' | 'desktop';
  platform: string;
  browser?: string;
  ipAddress: string;
  country?: string;
  isCurrent: boolean;
  isTrusted: boolean;
  lastSeenAt: string;
  createdAt: string;
}

export interface UserSession {
  id: string;
  userId: string;
  ipAddress: string;
  country?: string;
  device: string;
  isActive: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface ApiKey {
  id: string;
  userId: string;
  label: string;
  keyPrefix: string; // first 8 chars for display
  permissions: ('read' | 'trade' | 'withdraw')[];
  ipWhitelist: string[];
  isActive: boolean;
  lastUsedAt?: string;
  createdAt: string;
  expiresAt?: string;
}

export interface NotificationPreferences {
  trade: boolean;
  deposit: boolean;
  withdrawal: boolean;
  p2p: boolean;
  earn: boolean;
  security: boolean;
  marketing: boolean;
  priceAlerts: boolean;
  systemAnnouncements: boolean;
  channels: {
    inApp: boolean;
    email: boolean;
    sms: boolean;
    push: boolean;
  };
}

export interface UserSettings {
  profile: Pick<UserProfile, 'username' | 'preferredCurrency' | 'preferredLanguage' | 'theme'>;
  notifications: NotificationPreferences;
  security: Pick<UserProfile, 'twoFaEnabled' | 'antiPhishingCode'>;
}

export interface ReferralStats {
  code: string;
  totalReferrals: number;
  activeReferrals: number;
  totalEarned: number;
  pendingEarned: number;
  currency: string;
  commissionRate: number; // percentage
}
