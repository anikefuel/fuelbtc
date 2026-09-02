// NotificationStore — context + reducer for in-app notifications
// Wraps the entire app; exposes unreadCount and action dispatchers

import React, { createContext, useReducer, useEffect, useCallback, useMemo } from 'react';
import type { AppNotification, NotificationState, NotificationAction } from '@/types';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  subscribeToNotifications,
} from '@/api/notifications';
import { useSession } from '@/ctx';

// ─── Reducer ─────────────────────────────────────────────────────────────────
function reducer(state: NotificationState, action: NotificationAction): NotificationState {
  switch (action.type) {
    case 'SET_NOTIFICATIONS':
      return {
        ...state,
        notifications: action.payload,
        unreadCount: action.payload.filter(n => !n.isRead).length,
        lastFetchedAt: Date.now(),
      };
    case 'ADD_NOTIFICATION':
      return {
        ...state,
        notifications: [action.payload, ...state.notifications],
        unreadCount: state.unreadCount + (action.payload.isRead ? 0 : 1),
      };
    case 'MARK_READ':
      return {
        ...state,
        notifications: state.notifications.map(n =>
          n.id === action.payload.id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n
        ),
        unreadCount: Math.max(0, state.unreadCount - 1),
      };
    case 'MARK_ALL_READ':
      return {
        ...state,
        notifications: state.notifications.map(n => ({ ...n, isRead: true })),
        unreadCount: 0,
      };
    case 'REMOVE_NOTIFICATION':
      return {
        ...state,
        notifications: state.notifications.filter(n => n.id !== action.payload.id),
        unreadCount: state.notifications.find(n => n.id === action.payload.id && !n.isRead)
          ? Math.max(0, state.unreadCount - 1)
          : state.unreadCount,
      };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    default:
      return state;
  }
}

const INITIAL_STATE: NotificationState = {
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  lastFetchedAt: null,
};

// ─── Context ──────────────────────────────────────────────────────────────────
interface NotificationContextValue extends NotificationState {
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  addLocal: (n: AppNotification) => void;
  refresh: () => Promise<void>;
}

export const NotificationContext = createContext<NotificationContextValue>({
  ...INITIAL_STATE,
  markRead: async () => {},
  markAllRead: async () => {},
  addLocal: () => {},
  refresh: async () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const { session } = useSession();
  const userId = (session?.user?.id as string) ?? null;

  const refresh = useCallback(async () => {
    if (!userId) return;
    dispatch({ type: 'SET_LOADING', payload: true });
    const res = await fetchNotifications(userId);
    if (res.data) dispatch({ type: 'SET_NOTIFICATIONS', payload: res.data });
    dispatch({ type: 'SET_LOADING', payload: false });
  }, [userId]);

  // Load on mount / user change
  useEffect(() => {
    if (!userId) return;
    (async () => { await refresh(); })();

    // Subscribe to realtime inserts
    const unsubscribe = subscribeToNotifications(userId, n => {
      dispatch({ type: 'ADD_NOTIFICATION', payload: n });
    });
    return unsubscribe;
  }, [userId, refresh]);

  const markRead = useCallback(async (id: string) => {
    dispatch({ type: 'MARK_READ', payload: { id } });
    await markNotificationRead(id);
  }, []);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    dispatch({ type: 'MARK_ALL_READ' });
    await markAllNotificationsRead(userId);
  }, [userId]);

  const addLocal = useCallback((n: AppNotification) => {
    dispatch({ type: 'ADD_NOTIFICATION', payload: n });
  }, []);

  const value = useMemo<NotificationContextValue>(() => ({
    ...state,
    markRead,
    markAllRead,
    addLocal,
    refresh,
  }), [state, markRead, markAllRead, addLocal, refresh]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}
