// Notification types

export type NotificationCategory =
  | 'trade'
  | 'deposit'
  | 'withdrawal'
  | 'p2p'
  | 'earn'
  | 'security'
  | 'system'
  | 'announcement'
  | 'kyc'
  | 'price_alert'
  | 'referral';

export type NotificationPriority = 'low' | 'medium' | 'high' | 'critical';

export interface AppNotification {
  id: string;
  userId?: string;
  category: NotificationCategory;
  title: string;
  body: string;
  priority: NotificationPriority;
  isRead: boolean;
  actionUrl?: string;   // deep-link route, e.g. "/(app)/(tabs)/wallet"
  actionLabel?: string; // e.g. "View Order"
  metadata?: Record<string, string | number | boolean>;
  createdAt: string;
  readAt?: string;
  expiresAt?: string;
}

export interface NotificationGroup {
  category: NotificationCategory;
  label: string;
  icon: string;
  unreadCount: number;
  latest?: AppNotification;
}

// Used in NotificationStore
export interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  lastFetchedAt: number | null;
}

export type NotificationAction =
  | { type: 'SET_NOTIFICATIONS'; payload: AppNotification[] }
  | { type: 'ADD_NOTIFICATION'; payload: AppNotification }
  | { type: 'MARK_READ'; payload: { id: string } }
  | { type: 'MARK_ALL_READ' }
  | { type: 'REMOVE_NOTIFICATION'; payload: { id: string } }
  | { type: 'SET_LOADING'; payload: boolean };
