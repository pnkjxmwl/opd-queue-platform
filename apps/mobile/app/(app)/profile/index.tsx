import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MeResponse, Patient } from '@opd/contracts';
import { useApi } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useCity } from '../../../lib/city';
import { Icon } from '../../../lib/icon';
import { QueryState, Row } from '../../../lib/discovery';
import { Avatar, Button, Screen, SectionLabel } from '../../../lib/ui';
import { theme } from '../../../theme';

/** The account: who you are, who you book for, and the way out. */
export default function Profile() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { city } = useCity();

  const me = useApi<MeResponse>('/me');
  // Same cache key home uses, so this costs nothing on a warm app.
  const patients = useApi<Patient[]>('/patients');
  const self = patients.data?.find((p) => p.relation === 'SELF');
  const count = patients.data?.length ?? 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.identity}>
          <Avatar name={self?.name ?? me.data?.email ?? '?'} size={64} />
          <View style={styles.identityText}>
            <Text style={styles.name}>{self?.name ?? 'Your account'}</Text>
            <Text style={styles.muted}>{me.data?.email ?? ' '}</Text>
          </View>
        </View>

        <QueryState pending={me.isPending} error={me.error} onRetry={() => void me.refetch()} />

        <SectionLabel>Booking</SectionLabel>
        <Row
          icon="users"
          title="Family profiles"
          subtitle={count === 0 ? 'Add the people you book for' : `${count} ${count === 1 ? 'person' : 'people'}`}
          onPress={() => router.push('/profile/patients')}
        />
        <Row
          icon="map-pin"
          title="City"
          subtitle={city ?? 'Not set'}
          onPress={() => router.push('/location')}
        />

        <SectionLabel>Your visits</SectionLabel>
        {/* Honest about what does not exist yet, rather than an empty list that
            looks broken - the same rule the disabled Join button follows. */}
        <View style={styles.soon}>
          <Icon name="clock" size={20} color={theme.color.primary} />
          <Text style={styles.soonText}>
            Your tokens and past visits will appear here once booking is switched on.
          </Text>
        </View>

        <View style={styles.signOut}>
          <Button title="Sign out" variant="secondary" icon="log-out" onPress={() => void signOut()} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: theme.space[4], gap: theme.space[3], paddingBottom: theme.space[8] },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[4],
    paddingVertical: theme.space[4],
  },
  identityText: { flex: 1, gap: 2 },
  name: { ...theme.font.h1, color: theme.color.text },
  muted: { ...theme.font.body, color: theme.color.textMuted },

  soon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[3],
    backgroundColor: theme.color.teal[50],
    borderRadius: theme.radius.lg,
    padding: theme.space[4],
  },
  soonText: { ...theme.font.body, color: theme.color.text, flex: 1 },

  signOut: { marginTop: theme.space[4] },
});
