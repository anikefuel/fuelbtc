import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="trade" />
      <Stack.Screen name="p2p" />
      <Stack.Screen name="admin" />
      <Stack.Screen name="orders" />
      <Stack.Screen name="wallet" />
      <Stack.Screen name="security" />
    </Stack>
  );
}
