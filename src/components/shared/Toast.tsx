// Toast — lightweight in-app notification system

import React, { createContext, useContext, useCallback, useState, useRef } from 'react';
import { View, Text, Animated, Pressable } from 'react-native';
import { CheckCircle, AlertTriangle, XCircle, Info, X } from 'lucide-react-native';
import { DS } from '@/lib/design';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextValue {
  show: (type: ToastType, message: string, duration?: number) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_CONFIG: Record<ToastType, { color: string; bg: string; Icon: React.ComponentType<{ size: number; color: string }> }> = {
  success: { color: DS.color.buy,  bg: DS.color.buyBg,  Icon: CheckCircle },
  error:   { color: DS.color.sell, bg: DS.color.sellBg, Icon: XCircle },
  warning: { color: DS.color.warn, bg: DS.color.warnBg, Icon: AlertTriangle },
  info:    { color: DS.color.info, bg: DS.color.infoBg, Icon: Info },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const config = TOAST_CONFIG[toast.type];
  const { Icon } = config;
  const anim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start(onDismiss);
    }, toast.duration ?? 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Animated.View style={{
      opacity: anim,
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }],
      backgroundColor: DS.color.card,
      borderRadius: DS.radius.sm,
      borderWidth: 1,
      borderColor: DS.color.border2,
      borderLeftWidth: 3,
      borderLeftColor: config.color,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: DS.space.sm,
      paddingHorizontal: DS.space.md,
      gap: DS.space.sm,
      marginBottom: DS.space.xs,
    }}>
      <Icon size={16} color={config.color} />
      <Text style={{
        flex: 1,
        color: DS.color.text1,
        fontSize: DS.font.sm,
        fontWeight: DS.font.medium,
        lineHeight: 20,
      }}>
        {toast.message}
      </Text>
      <Pressable onPress={onDismiss}>
        <X size={14} color={DS.color.text2} />
      </Pressable>
    </Animated.View>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const show = useCallback((type: ToastType, message: string, duration = 3000) => {
    const id = String(++counter.current);
    setToasts(prev => [...prev.slice(-2), { id, type, message, duration }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const ctx: ToastContextValue = {
    show,
    success: (m) => show('success', m),
    error:   (m) => show('error', m),
    warning: (m) => show('warning', m),
    info:    (m) => show('info', m),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {toasts.length > 0 && (
        <View style={{
          position: 'absolute',
          top: 60,
          left: DS.space.md,
          right: DS.space.md,
          zIndex: 9999,
        }}>
          {toasts.map(t => (
            <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
