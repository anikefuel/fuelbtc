// EmptyState — premium empty list / zero-data placeholder

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { DS } from '@/lib/design';

interface EmptyStateProps {
  icon?: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon = '📭', title, subtitle, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 64, paddingHorizontal: 40, gap: 16 }}>
      {/* Icon container */}
      <View style={{
        width: 80, height: 80, borderRadius: DS.radius.xxl,
        backgroundColor: DS.color.surface,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: DS.color.border2,
      }}>
        <Text style={{ fontSize: 36 }}>{icon}</Text>
      </View>
      <View style={{ alignItems: 'center', gap: 8 }}>
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.base, textAlign: 'center' }}>
          {title}
        </Text>
        {subtitle && (
          <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center', lineHeight: 20 }}>
            {subtitle}
          </Text>
        )}
      </View>
      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          style={{
            backgroundColor: DS.color.goldBg,
            borderRadius: DS.radius.sm,
            borderWidth: 1,
            borderColor: DS.color.gold,
            paddingHorizontal: 24,
            paddingVertical: 10,
            marginTop: 4,
          }}
        >
          <Text style={{ color: DS.color.gold, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>
            {actionLabel}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
