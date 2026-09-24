import { Stack } from 'expo-router';

export default function SecurityLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="change-password" />
      <Stack.Screen name="totp-setup" />
      <Stack.Screen name="passkeys" />
      <Stack.Screen name="sessions" />
      <Stack.Screen name="login-history" />
    </Stack>
  );
}
