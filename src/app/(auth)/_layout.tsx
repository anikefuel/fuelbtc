import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { DS } from '@/lib/design';

export default function AuthLayout() {
  return (
    <>
      <StatusBar style="light" backgroundColor={DS.color.bg} />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
