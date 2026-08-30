import { Stack } from 'expo-router';
import { theme } from '../../../theme';

/**
 * The Discover tab's stack.
 *
 * These screenOptions are the ones that were missing. The root layout sets the same
 * options on the ROOT stack, whose only children are the route groups - so they
 * never reached a screen, and every screen in the app was rendering React
 * Navigation's stock default header. A nested navigator inherits nothing.
 */
export const stackOptions = {
  headerStyle: { backgroundColor: theme.color.surface },
  headerTintColor: theme.color.primary,
  headerTitleStyle: { ...theme.font.h3, color: theme.color.text },
  // A hairline divider reads cleaner than the platform's default drop shadow and
  // matches the flat, calm surfaces in docs/Design.md 4.
  headerShadowVisible: false,
  contentStyle: { backgroundColor: theme.color.canvas },
} as const;

export default function DiscoverLayout() {
  return (
    <Stack screenOptions={stackOptions}>
      {/* Home draws its own header block, so the navigator's is off here only. */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}
