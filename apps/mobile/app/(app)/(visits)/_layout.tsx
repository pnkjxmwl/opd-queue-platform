import { Stack } from 'expo-router';
import { stackOptions } from '../(discover)/_layout';

/**
 * The My Visits tab's own stack (docs/Design.md 5.9).
 *
 * Header styling is imported from the discover stack rather than copied: a nested
 * navigator inherits nothing from the root, so every tab must set its own, and two
 * copies of the same styling drift the moment one is edited.
 */
/**
 * Deep-linking straight to a token must still leave the list beneath it, or there is
 * nothing to go back to.
 */
export const unstable_settings = { initialRouteName: 'visits' };

export default function VisitsLayout() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="visits" options={{ title: 'My Visits' }} />
      <Stack.Screen name="join" options={{ title: 'Confirm booking' }} />
      {/*
        `visit/[id]`, not `[id]`. A bare `[id]` in a route GROUP sits at the root
        of the URL space and becomes a catch-all that shadows every other
        top-level path - `/location` and `/doctors` among them. The extra segment
        keeps it addressable and harmless, exactly as `session/[id]` does in the
        discover stack.
      */}
      <Stack.Screen name="visit/[id]" options={{ title: 'Your token' }} />
    </Stack>
  );
}
