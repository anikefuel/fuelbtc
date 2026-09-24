import React from 'react';
import * as Sentry from '@sentry/react-native';
import { Stack } from 'expo-router';
import { PortalHost } from '@rn-primitives/portal';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { SessionProvider, useSession } from '@/ctx';
import { NotificationProvider } from '@/stores/NotificationStore';
import { ThemeProvider } from '@/stores/ThemeStore';
import { ToastProvider } from '@/components/shared/Toast';
import { Skeleton } from '@/components/shared/LoadingState';
import { StepUpProvider } from '@/components/security/StepUpProvider';
import { DS } from '@/lib/design';
import '../global.css';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
});

function RootLayoutNav() {
  const { session, isLoading } = useSession();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, justifyContent: 'flex-end', padding: DS.space.md, gap: DS.space.sm }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} height={60} radius={DS.radius.md} />
        ))}
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}

const RootLayout: React.FC = () => {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <SessionProvider>
          <NotificationProvider>
            <ToastProvider>
              <StepUpProvider>
                <StatusBar style="light" backgroundColor={DS.color.bg} />
                <RootLayoutNav />
                <PortalHost />
              </StepUpProvider>
            </ToastProvider>
          </NotificationProvider>
        </SessionProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
};

export default Sentry.wrap(RootLayout);
