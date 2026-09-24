// XCard — premium card container with optional press and border accent

import React from 'react';
import { View, Pressable } from 'react-native';
import { DS } from '@/lib/design';

interface XCardProps {
  children: React.ReactNode;
  onPress?: () => void;
  padding?: number;
  radius?: number;
  accent?: 'buy' | 'sell' | 'gold' | 'none';
  style?: object;
  elevated?: boolean;
}

export function XCard({
  children,
  onPress,
  padding = DS.space.md,
  radius = DS.radius.md,
  accent = 'none',
  style,
  elevated = false,
}: XCardProps) {
  const accentColor = accent === 'buy' ? DS.color.buy : accent === 'sell' ? DS.color.sell : accent === 'gold' ? DS.color.gold : undefined;

  const inner = (
    <View style={[
      {
        backgroundColor: elevated ? DS.color.cardAlt : DS.color.card,
        borderRadius: radius,
        padding,
        borderWidth: 1,
        borderColor: accentColor ? accentColor + '40' : DS.color.border,
        ...(accentColor ? { borderLeftWidth: 3, borderLeftColor: accentColor } : {}),
      },
      style,
    ]}>
      {children}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={{ opacity: 1 }}
      >
        {inner}
      </Pressable>
    );
  }

  return inner;
}
