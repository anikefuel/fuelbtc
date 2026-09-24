// CoinIcon — reusable crypto coin icon with premium styling

import React from 'react';
import { View, Text } from 'react-native';
import { ASSET_REGISTRY } from '@/constants/assets';
import { DS } from '@/lib/design';

interface CoinIconProps {
  symbol: string;
  size?: number;
  style?: object;
}

export function CoinIcon({ symbol, size = 36, style }: CoinIconProps) {
  const def = ASSET_REGISTRY[symbol.toUpperCase()];
  const emoji = def?.icon ?? '💎';
  const color = def?.color ?? DS.color.text2;

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: `${color}20`,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: `${color}30`,
        },
        style,
      ]}
    >
      <Text style={{ fontSize: size * 0.48 }}>{emoji}</Text>
    </View>
  );
}
