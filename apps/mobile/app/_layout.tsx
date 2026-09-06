import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../lib/auth';
import { CityProvider } from '../lib/city';
import { RealtimeProvider } from '../lib/realtime';
import { usePushRegistration } from '../lib/push';
import { theme } from '../theme';

/**
 * Auth gate. Redirects between the (auth) and (app) groups based on session state,
 * so a signed-out user can never land on an app screen and vice versa.
 */
function Gate() {
  const { ready, signedIn } = useAuth();

  /**
   * Inter, the typeface docs/Design.md has specified since Phase 1 and which nothing
   * ever loaded - theme.ts named it and the app rendered in Roboto regardless.
   *
   * Bundled with the app rather than fetched, so it is there on a cold start in a
   * hospital basement with no signal.
   *
   * Gated on the SPLASH THAT ALREADY EXISTS below rather than a second one. That
   * splash is already waiting on the keychain read, and both waits are the same
   * wait as far as the person holding the phone is concerned; a second spinner - or
   * worse, rendering in Roboto and then reflowing into Inter a beat later - would be
   * two visible events where there should be none.
   */
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  // `|| fontError` so a font that fails to decode degrades to the system face instead
  // of leaving the app on its splash forever. A missing typeface is a cosmetic
  // problem; a patient who cannot reach their token is not.
  const fontsSettled = fontsLoaded || fontError !== null;

  // P8-MOB-01. Inside the gate because it needs a session, and once for the whole
  // app: permission, token registration, and opening the right screen on a tap.
  usePushRegistration();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!signedIn && !inAuthGroup) router.replace('/(auth)/login');
    if (signedIn && inAuthGroup) router.replace('/');
  }, [ready, signedIn, segments, router]);

  if (!ready || !fontsSettled) {
    // Reading the keychain is async; showing the login screen first would flash it
    // at users who are already signed in. The font load joins the same wait.
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={theme.color.primary} />
      </View>
    );
  }

  /**
   * The (app) group brings its own Tabs navigator and each tab its own Stack, so
   * this root stack only ever switches between the two groups - hence no header.
   * Header styling lives in app/(app)/(discover)/_layout.tsx: a nested navigator
   * inherits nothing, and setting it here reached no screen at all.
   */
  return <Stack screenOptions={{ headerShown: false, contentStyle: styles.canvas }} />;
}

/**
 * Query defaults, which this app had none of.
 *
 * A bare `new QueryClient()` leaves `staleTime` at 0, so every screen mount, every
 * back-navigation and every return to the foreground refires the request - and on a
 * phone that is not just load, it is a skeleton flashing over data the user was
 * already looking at.
 *
 * Thirty seconds is chosen against what these queries actually are: hospitals,
 * departments, doctors and a patient's own profiles, none of which change while
 * somebody browses. **It does not make the live screens stale.** Anything that has
 * to keep moving passes its own `refetchInterval` (`FALLBACK_POLL_MS`,
 * `LIVE_POLL_MS`, `CONFIRM_POLL_MS`), and the realtime socket invalidates queries
 * directly - neither path is gated by `staleTime`.
 *
 * One retry, not three: a patient on a hospital's wi-fi would otherwise wait through
 * three silent backoffs before being told anything is wrong, and `useApi` already
 * turns a transport failure into "you appear to be offline".
 */
const queryDefaults = {
  queries: { staleTime: 30_000, retry: 1 },
} as const;

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: queryDefaults }));

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {/*
            Inside AuthProvider (it needs the token) and inside QueryClientProvider
            (it invalidates queries). One socket for the whole app - a patient
            flicking between a session card and their token must not reconnect on
            every navigation.
          */}
          <RealtimeProvider>
            <CityProvider>
              <StatusBar style="dark" />
              <Gate />
            </CityProvider>
          </RealtimeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = {
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.canvas,
  },
  canvas: { backgroundColor: theme.color.canvas },
} as const;
