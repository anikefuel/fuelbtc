// P2P Order — redirects to the real active-trade screen
// This route is kept as a thin redirect to avoid breaking any existing
// deep-links that point to /(app)/p2p/order?id=<uuid>
import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { DS } from '@/lib/design';
import type { RelativePathString } from 'expo-router';

export default function P2POrderRedirect() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();

  useEffect(() => {
    if (id) {
      router.replace(`/(app)/p2p/active-trade?id=${id}` as RelativePathString);
    } else {
      router.replace('/(app)/p2p/my-orders' as RelativePathString);
    }
  }, [id, router]);

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={DS.color.gold} />
    </View>
  );
}
