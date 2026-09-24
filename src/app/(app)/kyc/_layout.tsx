import { Stack } from 'expo-router';

export default function KycLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="dojah/[attemptId]"   options={{ gestureEnabled: false }} />
      <Stack.Screen name="prembly/[attemptId]" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
