import { Redirect } from 'expo-router';
import { useSession } from '@/ctx';
import { View } from 'react-native';
import { Skeleton } from '@/components/shared/LoadingState';
import { DS } from '@/lib/design';

export default function Index() {
  const { session, isLoading } = useSession();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, padding: DS.space.md, gap: DS.space.sm, justifyContent: 'flex-end' }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} height={56} radius={DS.radius.md} />
        ))}
      </View>
    );
  }

  return session ? (
    <Redirect href="/(app)/(tabs)/home" />
  ) : (
    <Redirect href="/(auth)/sign-in" />
  );
}
