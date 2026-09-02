// XInput — premium text input with icon slots and focus state

import React, { useState, useRef } from 'react';
import { View, TextInput, Text, Pressable, TextInputProps } from 'react-native';
import { DS } from '@/lib/design';

interface XInputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onRightIconPress?: () => void;
  size?: 'sm' | 'md';
}

export function XInput({
  label,
  error,
  hint,
  leftIcon,
  rightIcon,
  onRightIconPress,
  size = 'md',
  style,
  ...props
}: XInputProps) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const height    = size === 'sm' ? 42 : 50;
  const fontSize  = size === 'sm' ? DS.font.xs : DS.font.sm;
  const px        = DS.space.md;

  const borderColor = error
    ? DS.color.sell
    : focused
      ? DS.color.gold
      : DS.color.border;

  return (
    <View style={{ gap: 6 }}>
      {label && (
        <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.medium, letterSpacing: 0.3 }}>
          {label.toUpperCase()}
        </Text>
      )}
      <Pressable
        onPress={() => inputRef.current?.focus()}
        style={{
          height,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: DS.color.card,
          borderRadius: DS.radius.sm,
          borderWidth: 1.5,
          borderColor,
          paddingHorizontal: px,
          gap: 10,
        }}
      >
        {leftIcon && <View style={{ opacity: focused ? 1 : 0.6 }}>{leftIcon}</View>}
        <TextInput
          ref={inputRef}
          style={[{
            flex: 1,
            color: DS.color.text1,
            fontSize,
            paddingVertical: 0,
          }, style]}
          placeholderTextColor={DS.color.text3}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...props}
        />
        {rightIcon && (
          <Pressable onPress={onRightIconPress}>
            <View style={{ opacity: 0.7 }}>{rightIcon}</View>
          </Pressable>
        )}
      </Pressable>
      {error && (
        <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>
          {error}
        </Text>
      )}
      {hint && !error && (
        <Text style={{ color: DS.color.text3, fontSize: DS.font.xs }}>
          {hint}
        </Text>
      )}
    </View>
  );
}
