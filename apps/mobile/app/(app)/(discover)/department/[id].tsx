import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { Paginated, SessionCard } from '@opd/contracts';
import { useApi } from '../../../../lib/api';
import { MoreNote, PAGE, QueryState, SessionCardView } from '../../../../lib/discovery';
import { theme } from '../../../../theme';

/**
 * Today's session cards for one department - the screen the whole browse path
 * exists to reach (docs/Design.md 5.5).
 *
 * No date picker: "today" is the server's IST today and Phase 3 shows only that.
 * A phone's own clock is wrong for the half hour after IST midnight, so the date
 * is deliberately not sent.
 */
export default function DepartmentSessions() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const sessions = useApi<Paginated<SessionCard>>(`/departments/${id}/sessions?limit=${PAGE}`);
  const first = sessions.data?.items[0];

  return (
    <>
      <Stack.Screen options={{ title: first?.departmentName ?? 'Today' }} />
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        data={sessions.data?.items ?? []}
        keyExtractor={(session) => session.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>{first?.departmentName ?? 'Today’s OPD'}</Text>
            <Text style={styles.muted}>
              {first ? first.hospitalName : 'Sessions running today'}
            </Text>
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
            emptyText="No OPD sessions here today. Try another department."
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
  header: { gap: theme.space[1], marginBottom: theme.space[4] },
  title: { ...theme.font.h1, color: theme.color.text },
  muted: { ...theme.font.body, color: theme.color.textMuted },
  gap: { height: theme.space[4] },
});
