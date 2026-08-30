import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../lib/auth';
import { Button, ErrorNote, Field } from '../../lib/ui';
import { theme } from '../../theme';

export default function Signup() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit() {
    setPending(true);
    setError(null);
    try {
      // The name creates the account holder's own SELF patient profile server-side.
      await signUp(email.trim(), password, name.trim() || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-up failed');
      setPending(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Create account' }} />

      <View style={styles.intro}>
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.subtitle}>
          Your name becomes your first patient profile — you can add family later.
        </Text>
      </View>

      <Field
        label="Your name"
        value={name}
        onChangeText={setName}
        autoComplete="name"
        autoCapitalize="words"
        icon="user"
      />
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
        autoComplete="new-password"
        icon="lock"
        helper="At least 10 characters."
      />

      {error && <ErrorNote message={error} />}

      <Button title="Create account" onPress={onSubmit} pending={pending} />
      <Button title="Back to sign in" variant="secondary" onPress={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: theme.space[5],
    gap: theme.space[4],
    backgroundColor: theme.color.canvas,
  },
  intro: { gap: theme.space[1] },
  title: { ...theme.font.h1, color: theme.color.text },
  subtitle: { ...theme.font.body, color: theme.color.textMuted },
});
