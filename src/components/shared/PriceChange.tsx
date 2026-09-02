// PriceChange — compact price movement indicator

import React from 'react';
import { View, Text } from 'react-native';
import { TrendingUp, TrendingDown } from 'lucide-react-native';
import { DS } from '@/lib/design';

interface PriceChangeProps {
  value: number;
  suffix?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  showBg?: boolean;
}

export function PriceChange({ value, suffix = '%', size = 'sm', showIcon = false, showBg = false }: PriceChangeProps) {
  const isPos = value >= 0;
  const color  = isPos ? DS.color.buy : DS.color.sell;
  const bg     = isPos ? DS.color.buyBg : DS.color.sellBg;
  const fontSize = size === 'xs' ? 10 : size === 'sm' ? 12 : size === 'md' ? 14 : 16;
  const iconSz   = size === 'xs' ? 10 : size === 'sm' ? 12 : 14;

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 3,
      ...(showBg ? {
        backgroundColor: bg,
        borderRadius: DS.radius.xs,
        paddingHorizontal: 6,
        paddingVertical: 2,
      } : {}),
    }}>
      {showIcon && (
        isPos
          ? <TrendingUp size={iconSz} color={color} />
          : <TrendingDown size={iconSz} color={color} />
      )}
      <Text style={{ color, fontSize, fontWeight: DS.font.semibold }}>
        {isPos ? '+' : ''}{value.toFixed(2)}{suffix}
      </Text>
    </View>
  );
}
