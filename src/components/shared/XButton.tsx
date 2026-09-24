// XButton — premium ExchangeX button component

import React from 'react';
import { Pressable, Text, ActivityIndicator, View } from 'react-native';
import { DS } from '@/lib/design';

type Variant = 'primary' | 'secondary' | 'buy' | 'sell' | 'ghost' | 'danger' | 'outline';
type Size    = 'sm' | 'md' | 'lg';

interface XButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
}

const VARIANT_STYLES: Record<Variant, { bg: string; text: string; border?: string }> = {
  primary:   { bg: DS.color.gold,    text: DS.color.bg },
  secondary: { bg: DS.color.surface, text: DS.color.text1, border: DS.color.border2 },
  buy:       { bg: DS.color.buy,     text: '#fff' },
  sell:      { bg: DS.color.sell,    text: '#fff' },
  danger:    { bg: DS.color.sell,    text: '#fff' },
  ghost:     { bg: 'transparent',    text: DS.color.gold, border: DS.color.gold + '50' },
  outline:   { bg: 'transparent',    text: DS.color.text1, border: DS.color.border2 },
};

const SIZE_STYLES: Record<Size, { height: number; px: number; fontSize: number; radius: number }> = {
  sm: { height: 36, px: 16, fontSize: DS.font.xs,   radius: DS.radius.sm },
  md: { height: 48, px: 20, fontSize: DS.font.sm,   radius: DS.radius.sm },
  lg: { height: 54, px: 24, fontSize: DS.font.base, radius: DS.radius.md },
};

export function XButton({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  icon,
  iconRight,
}: XButtonProps) {
  const vs = VARIANT_STYLES[variant];
  const ss = SIZE_STYLES[size];
  const isDisabled = disabled || loading;
  const [pressed, setPressed] = React.useState(false);

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={{
        height: ss.height,
        paddingHorizontal: ss.px,
        borderRadius: ss.radius,
        backgroundColor: vs.bg,
        borderWidth: vs.border ? 1 : 0,
        borderColor: vs.border ?? 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 6,
        opacity: isDisabled ? 0.45 : pressed ? 0.82 : 1,
        alignSelf: fullWidth ? undefined : 'flex-start',
        width: fullWidth ? '100%' : undefined,
      }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={vs.text} />
      ) : (
        <>
          {icon && <View>{icon}</View>}
          <Text style={{
            color: vs.text,
            fontSize: ss.fontSize,
            fontWeight: DS.font.semibold,
            letterSpacing: 0.2,
          }}>
            {label}
          </Text>
          {iconRight && <View>{iconRight}</View>}
        </>
      )}
    </Pressable>
  );
}
