// LoadingState — premium skeleton loading placeholder

import React, { useEffect, useRef } from 'react';
import { View, Animated } from 'react-native';
import { DS } from '@/lib/design';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  radius?: number;
  style?: object;
}

export function Skeleton({ width = '100%', height = 16, radius = DS.radius.xs, style }: SkeletonProps) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: false }),
      ])
    ).start();
  }, [anim]);

  const bg = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [DS.color.shimmer1, DS.color.shimmer2],
  });

  return (
    <Animated.View
      style={[{ width: width as number, height, borderRadius: radius, backgroundColor: bg }, style]}
    />
  );
}

export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <View style={{
      backgroundColor: DS.color.card,
      borderRadius: DS.radius.md,
      padding: DS.space.md,
      gap: DS.space.sm,
      borderWidth: 1,
      borderColor: DS.color.border,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
        <Skeleton width={40} height={40} radius={DS.radius.full} />
        <View style={{ flex: 1, gap: 6 }}>
          <Skeleton width="50%" height={14} />
          <Skeleton width="30%" height={11} />
        </View>
        <Skeleton width={60} height={14} />
      </View>
      {Array.from({ length: rows - 1 }).map((_, i) => (
        <Skeleton key={i} height={12} radius={DS.radius.xs} />
      ))}
    </View>
  );
}

export function SkeletonList({ count = 4 }: { count?: number }) {
  return (
    <View style={{ gap: DS.space.xs }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} rows={2} />
      ))}
    </View>
  );
}

export default function LoadingState() {
  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg, padding: DS.space.md, gap: DS.space.sm }}>
      <SkeletonList count={5} />
    </View>
  );
}
