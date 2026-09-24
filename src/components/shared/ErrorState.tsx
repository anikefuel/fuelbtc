// ErrorState — rich error feedback with retry support

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { AlertTriangle, WifiOff, RefreshCw } from 'lucide-react-native';
import { DS } from '@/lib/design';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
  type?: 'generic' | 'network' | 'empty';
}

export function ErrorState({ message = 'Something went wrong', onRetry, type = 'generic' }: ErrorStateProps) {
  const Icon = type === 'network' ? WifiOff : AlertTriangle;

  return (
    <View style={{
      flex: 1, alignItems: 'center', justifyContent: 'center',
      paddingVertical: 64, paddingHorizontal: 40, gap: 16,
    }}>
      <View style={{
        width: 72, height: 72, borderRadius: DS.radius.xxl,
        backgroundColor: DS.color.sellBg,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: DS.color.sell + '40',
      }}>
        <Icon size={32} color={DS.color.sell} />
      </View>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.base, textAlign: 'center' }}>
          {type === 'network' ? 'No Connection' : 'Oops!'}
        </Text>
        <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center', lineHeight: 20 }}>
          {message}
        </Text>
      </View>
      {onRetry && (
        <Pressable
          onPress={onRetry}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            backgroundColor: DS.color.surface,
            borderRadius: DS.radius.sm,
            paddingHorizontal: 20, paddingVertical: 10,
            borderWidth: 1, borderColor: DS.color.border2,
          }}
        >
          <RefreshCw size={14} color={DS.color.text1} />
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.medium, fontSize: DS.font.sm }}>Try Again</Text>
        </Pressable>
      )}
    </View>
  );
}
