import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { Paginated, PublicDoctor, SessionCard } from '@opd/contracts';
import { useApi } from '../../../../lib/api';
import { Icon } from '../../../../lib/icon';
import { MoreNote, PAGE, QueryState, SessionCardView } from '../../../../lib/discovery';
import { Avatar, SectionLabel } from '../../../../lib/ui';
import { theme } from '../../../../theme';

/**
 * A doctor and the sessions they are running today.
 *
 * "Running", not "booked for": after a substitution (docs/PRD.md 8.11) the API
 * matches on the current provider, so a covering doctor's page shows the clinic
 * they are actually taking.
 */
export default function Doctor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const doctor = useApi<PublicDoctor>(`/doctors/${id}`);
  const sessions = useApi<Paginated<SessionCard>>(`/doctors/${id}/sessions?limit=${PAGE}`);

  return (
    <>
      <Stack.Screen options={{ title: doctor.data?.name ?? 'Doctor' }} />
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        data={sessions.data?.items ?? []}
        keyExtractor={(session) => session.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <QueryState
              pending={doctor.isPending}
              error={doctor.error}
              onRetry={() => void doctor.refetch()}
            />
            {doctor.data ? (
              <View style={styles.about}>
                <Avatar name={doctor.data.name} size={64} />
                <Text style={styles.title}>{doctor.data.name}</Text>
                <Text style={styles.muted}>
                  {doctor.data.specialization ?? doctor.data.departmentName}
                </Text>
                <View style={styles.line}>
                  <Icon name="home" size={14} color={theme.color.textMuted} />
                  <Text style={styles.muted}>
                    {doctor.data.hospitalName} · {doctor.data.hospitalCity}
                  </Text>
                </View>
                <View style={styles.line}>
                  <Icon name="clock" size={14} color={theme.color.textMuted} />
                  <Text style={styles.muted}>
                    About {doctor.data.defaultConsultMins} minutes per patient
                  </Text>
                </View>
              </View>
            ) : null}
            <SectionLabel>Today’s sessions</SectionLabel>
          </View>
        }
        renderItem={({ item }) => (
          <SessionCardView
            card={item}
            onPress={() => router.push({ pathname: '/session/[id]', params: { id: item.id } })}
          />
        )}
        ItemSeparatorComponent={Gap}
        ListEmptyComponent={
          <QueryState
            pending={sessions.isPending}
            error={sessions.error}
            isEmpty={sessions.isSuccess}
            emptyIcon="calendar"
            emptyText="This doctor has no OPD today."
            onRetry={() => void sessions.refetch()}
          />
        }
        ListFooterComponent={
          sessions.data ? (
            <MoreNote shown={sessions.data.items.length} total={sessions.data.total} />
          ) : null
        }
      />
    </>
  );
}

const Gap = () => <View style={styles.gap} />;

const styles = StyleSheet.create({
  list: { backgroundColor: theme.color.canvas },
  content: { padding: theme.space[4], paddingBottom: theme.space[8] },
  header: { gap: theme.space[4], marginBottom: theme.space[3] },
  about: { gap: theme.space[2], alignItems: 'flex-start' },
  title: { ...theme.font.h1, color: theme.color.text },
  line: { flexDirection: 'row', alignItems: 'center', gap: theme.space[2] },
  muted: { ...theme.font.body, color: theme.color.textMuted },
  gap: { height: theme.space[4] },
});
