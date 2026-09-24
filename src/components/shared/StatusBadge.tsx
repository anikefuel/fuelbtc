// StatusBadge — unified status indicator for orders, transactions, KYC, etc.

import React from 'react';
import { View, Text } from 'react-native';

type StatusVariant =
  | 'completed' | 'filled' | 'released'
  | 'pending' | 'open' | 'partially_filled' | 'paid'
  | 'failed' | 'cancelled' | 'rejected' | 'disputed'
  | 'active' | 'locked'
  | 'high' | 'medium' | 'low'
  | string;

interface StatusBadgeProps {
  status: StatusVariant;
  label?: string;
  size?: 'xs' | 'sm' | 'md';
}

const STATUS_MAP: Record<string, { color: string; bg: string }> = {
  completed:        { color: '#0ECB81', bg: '#0ECB8120' },
  filled:           { color: '#0ECB81', bg: '#0ECB8120' },
  released:         { color: '#0ECB81', bg: '#0ECB8120' },
  active:           { color: '#0ECB81', bg: '#0ECB8120' },
  paid:             { color: '#1E90FF', bg: '#1E90FF20' },
  pending:          { color: '#FFA726', bg: '#FFA72620' },
  open:             { color: '#F0B90B', bg: '#F0B90B20' },
  partially_filled: { color: '#F0B90B', bg: '#F0B90B20' },
  failed:           { color: '#F6465D', bg: '#F6465D20' },
  cancelled:        { color: '#4B5563', bg: '#4B556320' },
  rejected:         { color: '#F6465D', bg: '#F6465D20' },
  disputed:         { color: '#F6465D', bg: '#F6465D20' },
  locked:           { color: '#4B5563', bg: '#4B556320' },
  high:             { color: '#F6465D', bg: '#F6465D20' },
  medium:           { color: '#FFA726', bg: '#FFA72620' },
  low:              { color: '#848E9C', bg: '#848E9C20' },
};

const FALLBACK = { color: '#848E9C', bg: '#848E9C20' };

export function StatusBadge({ status, label, size = 'sm' }: StatusBadgeProps) {
  const { color, bg } = STATUS_MAP[status.toLowerCase()] ?? FALLBACK;
  const fontSize  = size === 'xs' ? 9  : size === 'sm' ? 10 : 12;
  const px        = size === 'xs' ? 5  : size === 'sm' ? 7  : 10;
  const py        = size === 'xs' ? 2  : size === 'sm' ? 3  : 5;
  const radius    = size === 'xs' ? 3  : 4;
  const displayText = label ?? status.replace(/_/g, ' ');

  return (
    <View style={{ backgroundColor: bg, borderRadius: radius, paddingHorizontal: px, paddingVertical: py, alignSelf: 'flex-start' }}>
      <Text style={{ color, fontSize, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {displayText}
      </Text>
    </View>
  );
}
