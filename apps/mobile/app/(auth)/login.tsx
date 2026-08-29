import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useAuth } from '../../lib/auth';
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
      <Stack.Screen options={{ title: 'Sign in' }} />
      <Text style={styles.title}>Welcome back</Text>
      <Text style={styles.subtitle}>Join a doctor&apos;s queue without waiting at the hospital.</Text>

      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="password"
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
  screen: { flexGrow: 1, justifyContent: 'center', padding: theme.space[4], gap: theme.space[4] },
  title: { ...theme.font.h1, color: theme.color.primary },
  subtitle: { ...theme.font.body, color: theme.color.textMuted, marginTop: -theme.space[2] },
  link: { ...theme.font.label, color: theme.color.primary, textAlign: 'center' },
});
