import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../lib/auth';
import { Icon } from '../../lib/icon';
import { Button, ErrorNote, Field } from '../../lib/ui';
import { theme } from '../../theme';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit() {
    setPending(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      // No navigation here - the gate in _layout redirects once signedIn flips.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
      setPending(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ headerShown: false }} />

      {/*
        Brand, centred, then the greeting left-aligned beneath it - the shape every
        reference auth screen uses (docs/ui-screens/01_login.png).
      */}
      <View style={styles.brand}>
        <View style={styles.mark}>
          <Icon name="activity" size={30} color="#FFFFFF" />
        </View>
        <Text style={styles.wordmark}>OPD Queue</Text>
      </View>

      <View style={styles.intro}>
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>
          Join a doctor&apos;s queue from home and arrive when it is nearly your turn.
        </Text>
      </View>

      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        icon="mail"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="password"
        icon="lock"
      />

      {error && <ErrorNote message={error} />}

      <Button title="Sign in" onPress={onSubmit} pending={pending} />

      <Link href="/(auth)/signup" style={styles.link}>
        New here? Create an account
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: theme.space[6],
    gap: theme.space[4],
    // White, not canvas. The reference auth screens sit on white and the fields
    // carry the only borders on the page; a grey ground makes a white input look
    // like a card sitting on something, which is one surface too many.
    backgroundColor: theme.color.surface,
  },
  brand: { alignItems: 'center', gap: theme.space[3], marginBottom: theme.space[4] },
  mark: {
    width: 64,
    height: 64,
    // A circle, per docs/ui-screens/01_login.png.
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: { ...theme.font.h2, color: theme.color.primary },
  intro: { gap: theme.space[1], marginBottom: theme.space[2] },
  title: { ...theme.font.h1, color: theme.color.text },
  subtitle: { ...theme.font.bodyLg, color: theme.color.textMuted },
  link: {
    ...theme.font.bodyLg,
    color: theme.color.primary,
    textAlign: 'center',
    marginTop: theme.space[2],
  },
});
