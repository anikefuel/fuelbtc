// useNotifications — notification list + read/unread state

import { useState, useCallback, useContext } from 'react';
import { useFocusEffect } from 'expo-router';
import { NotificationContext } from '@/stores/NotificationStore';
import type { AppNotification } from '@/types';

export function useNotifications() {
  return useContext(NotificationContext);
}

// Standalone hook for screens that just need the unread badge count
export function useUnreadCount(): number {
  const { unreadCount } = useContext(NotificationContext);
  return unreadCount;
}

// Lightweight hook to group notifications by category for a settings-style view
export function useNotificationGroups() {
  const { notifications } = useContext(NotificationContext);

  const groups = notifications.reduce<Record<string, AppNotification[]>>((acc, n) => {
    if (!acc[n.category]) acc[n.category] = [];
    acc[n.category].push(n);
    return acc;
  }, {});

  return groups;
}
