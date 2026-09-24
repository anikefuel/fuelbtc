// Notifications API module

import { supabase } from '@/client/supabase';
import type { ApiResponse, AppNotification, NotificationCategory, NotificationPriority } from '@/types';
import { buildApiError, apiCache } from './client';
import { CACHE_TTL } from '@/constants/config';

// ─── Fetch user notifications ─────────────────────────────────────────────────
export async function fetchNotifications(
  userId: string,
  limit = 50,
): Promise<ApiResponse<AppNotification[]>> {
  const cacheKey = `notifications:${userId}`;
  const cached = apiCache.get<AppNotification[]>(cacheKey);
  if (cached) return { data: cached, error: null, status: 200 };

  const { data: rows, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return { data: null, error: buildApiError('NOTIF_FETCH_ERROR', error.message), status: 500 };

  const notifications: AppNotification[] = (rows ?? []).map(row => ({
    id: row.id,
    userId: row.user_id,
    category: row.category as NotificationCategory,
    title: row.title,
    body: row.body,
    priority: row.priority as NotificationPriority,
    isRead: row.is_read,
    actionUrl: row.action_url,
    actionLabel: row.action_label,
    metadata: row.metadata,
    createdAt: row.created_at,
    readAt: row.read_at,
    expiresAt: row.expires_at,
  }));

  apiCache.set(cacheKey, notifications, CACHE_TTL.notifications);
  return { data: notifications, error: null, status: 200 };
}

// ─── Mark notification as read ────────────────────────────────────────────────
export async function markNotificationRead(
  notificationId: string,
): Promise<ApiResponse<void>> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', notificationId);

  if (error) return { data: null, error: buildApiError('NOTIF_READ_ERROR', error.message), status: 500 };
  return { data: undefined, error: null, status: 200 };
}

// ─── Mark all notifications as read ──────────────────────────────────────────
export async function markAllNotificationsRead(userId: string): Promise<ApiResponse<void>> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('is_read', false);

  if (error) return { data: null, error: buildApiError('NOTIF_READ_ALL_ERROR', error.message), status: 500 };

  apiCache.invalidatePrefix(`notifications:${userId}`);
  return { data: undefined, error: null, status: 200 };
}

// ─── Create a notification (server-side use or admin) ────────────────────────
export async function createNotification(
  userId: string,
  notification: Omit<AppNotification, 'id' | 'userId' | 'isRead' | 'createdAt'>,
): Promise<ApiResponse<AppNotification>> {
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      user_id: userId,
      category: notification.category,
      title: notification.title,
      body: notification.body,
      priority: notification.priority,
      is_read: false,
      action_url: notification.actionUrl,
      action_label: notification.actionLabel,
      metadata: notification.metadata,
      expires_at: notification.expiresAt,
    })
    .select('*')
    .single();

  if (error) return { data: null, error: buildApiError('NOTIF_CREATE_ERROR', error.message), status: 500 };

  apiCache.invalidatePrefix(`notifications:${userId}`);

  return {
    data: {
      id: data.id,
      userId: data.user_id,
      category: data.category,
      title: data.title,
      body: data.body,
      priority: data.priority,
      isRead: data.is_read,
      actionUrl: data.action_url,
      actionLabel: data.action_label,
      metadata: data.metadata,
      createdAt: data.created_at,
    },
    error: null,
    status: 201,
  };
}

// ─── Subscribe to realtime notifications via Supabase channel ────────────────
export function subscribeToNotifications(
  userId: string,
  onNew: (notification: AppNotification) => void,
): () => void {
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      payload => {
        const row = payload.new as Record<string, unknown>;
        onNew({
          id: row.id as string,
          userId: row.user_id as string,
          category: row.category as NotificationCategory,
          title: row.title as string,
          body: row.body as string,
          priority: row.priority as NotificationPriority,
          isRead: false,
          actionUrl: row.action_url as string | undefined,
          actionLabel: row.action_label as string | undefined,
          metadata: row.metadata as Record<string, string | number | boolean> | undefined,
          createdAt: row.created_at as string,
        });
      },
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
