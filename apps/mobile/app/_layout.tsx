import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../lib/auth';
import { CityProvider } from '../lib/city';
import { theme } from '../theme';

/**
 * Auth gate. Redirects between the (auth) and (app) groups based on session state,
 * so a signed-out user can never land on an app screen and vice versa.
 */
function Gate() {
  const { ready, signedIn } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!signedIn && !inAuthGroup) router.replace('/(auth)/login');
    if (signedIn && inAuthGroup) router.replace('/');
  }, [ready, signedIn, segments, router]);

  if (!ready) {
    // Reading the keychain is async; showing the login screen first would flash it
    // at users who are already signed in.
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

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CityProvider>
            <StatusBar style="dark" />
            <Gate />
          </CityProvider>
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
