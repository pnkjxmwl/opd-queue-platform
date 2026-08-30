import { Stack } from 'expo-router';
import { stackOptions } from '../(discover)/_layout';

/** The Profile tab's stack. Same header treatment as Discover - one source. */
export default function ProfileLayout() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}
