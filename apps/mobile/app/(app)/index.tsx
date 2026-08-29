import { useQuery } from '@tanstack/react-query';
import { Link, Stack } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MeResponse } from '@opd/contracts';
import { useAuth } from '../../lib/auth';
import { Button, ErrorNote } from '../../lib/ui';
import { theme } from '../../theme';

export default function Home() {
  const { authedFetch, signOut } = useAuth();

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<MeResponse> => {
      const res = await authedFetch('/me');
      if (!res.ok) throw new Error('Could not load your account');
      return res.json() as Promise<MeResponse>;
    },
  });

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Stack.Screen options={{ title: 'OPD Queue' }} />

      <Text style={styles.title}>You&apos;re signed in</Text>
      {me.isPending && <Text style={styles.muted}>Loading your account…</Text>}
      {me.isError && <ErrorNote message={me.error.message} />}
      {me.data && <Text style={styles.muted}>{me.data.email}</Text>}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Family profiles</Text>
        <Text style={styles.muted}>
          Add the people you book for — yourself, parents, children.
        </Text>
        <Link href="/(app)/patients" asChild>
          <Text style={styles.link}>Manage profiles →</Text>
        </Link>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Find a doctor</Text>
        <Text style={styles.muted}>
          Browsing hospitals and joining a queue arrives in Phase 3.
        </Text>
      </View>

      <Button title="Sign out" variant="secondary" onPress={() => void signOut()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: theme.space[4], gap: theme.space[4] },
  title: { ...theme.font.h2, color: theme.color.text },
  muted: { ...theme.font.body, color: theme.color.textMuted },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space[5],
    gap: theme.space[2],
  },
  cardTitle: { ...theme.font.h3, color: theme.color.text },
  link: { ...theme.font.label, color: theme.color.primary, marginTop: theme.space[2] },
});
