// ScreenHeader — premium top navigation bar

import React from 'react';
import { View, Text, Pressable, StatusBar, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { DS } from '@/lib/design';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  right?: React.ReactNode;
  transparent?: boolean;
  accent?: boolean;
}

export function ScreenHeader({
  title,
  subtitle,
  showBack = true,
  onBack,
  right,
  transparent = false,
  accent = false,
}: ScreenHeaderProps) {
  const router = useRouter();

  return (
    <View style={{
      paddingTop: Platform.OS === 'ios' ? 52 : (StatusBar.currentHeight ?? 24) + 8,
      paddingHorizontal: DS.space.md,
      paddingBottom: DS.space.sm,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: transparent ? 'transparent' : DS.color.bg,
      borderBottomWidth: transparent ? 0 : 1,
      borderBottomColor: DS.color.border,
      gap: DS.space.xs,
    }}>
      {showBack && (
        <Pressable
          onPress={onBack ?? (() => router.back())}
          style={{
            width: 36, height: 36, borderRadius: DS.radius.full,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: DS.color.surface,
          }}
        >
          <ChevronLeft size={20} color={DS.color.text1} />
        </Pressable>
      )}
      <View style={{ flex: 1, marginLeft: showBack ? 4 : 0 }}>
        <Text style={{
          color: accent ? DS.color.gold : DS.color.text1,
          fontSize: DS.font.base,
          fontWeight: DS.font.bold,
          letterSpacing: 0.2,
        }}>
          {title}
        </Text>
        {subtitle && (
          <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginTop: 1 }}>
            {subtitle}
          </Text>
        )}
      </View>
      {right && <View>{right}</View>}
    </View>
  );
}
