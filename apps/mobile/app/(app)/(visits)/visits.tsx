import { useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MyQueueEntry, Paginated } from '@opd/contracts';
import { useApi } from '../../../lib/api';
import { Icon } from '../../../lib/icon';
import { QueryState } from '../../../lib/discovery';
import { EntryStatusPill } from '../../../lib/visits';
import { calendarDate, istClock } from '../../../lib/format';
import { pressable } from '../../../lib/ui';
import { theme } from '../../../theme';

/**
 * My Visits (docs/Design.md 5.9) - the third tab, which arrives with Phase 5
 * because there is finally something to list.
 *
 * **`visits.tsx`, not `index.tsx`.** Every segment above this is a route GROUP, so
 * an `index` here resolves to `/` - which `(discover)/index.tsx` already owns. Two
 * screens claiming one path is the same class of mistake as the bare `[id]` that
 * became a root catch-all; the generated route table is where it shows up, because
 * only ONE `/` ever appears in it.
 *
 * This is also the crash-recovery screen (docs/Architecture.md 12 case B): if the
 * app died between paying and seeing the token, the server still issued it from the
 * webhook, and opening this tab is how the patient finds it.
 */

/** Active visits move on their own, so this screen polls like the session screen. */
const LIVE_POLL_MS = 15_000;

export default function MyVisits() {
  const [scope, setScope] = useState<'active' | 'past'>('active');
  const query = useApi<Paginated<MyQueueEntry>>(
    `/me/queue-entries?scope=${scope}&limit=50`,
    true,
    scope === 'active' ? LIVE_POLL_MS : undefined,
  );

  const items = query.data?.items ?? [];

  return (
    <View style={styles.screen}>
      <View style={styles.tabs}>
        {(['active', 'past'] as const).map((value) => (
          <Pressable
            key={value}
            onPress={() => setScope(value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: scope === value }}
            style={[styles.tab, scope === value && styles.tabOn]}
            android_ripple={{ color: theme.color.teal[100] }}
          >
            <Text style={[styles.tabText, scope === value && styles.tabTextOn]}>
              {value === 'active' ? 'Upcoming' : 'Past'}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching && !query.isPending}
            onRefresh={() => void query.refetch()}
            tintColor={theme.color.primary}
            colors={[theme.color.primary]}
          />
        }
      >
        <QueryState
          pending={query.isPending}
          error={query.error}
          isEmpty={items.length === 0}
          emptyText={
            scope === 'active'
              ? 'No upcoming visits. Find a doctor from the Discover tab to book one.'
              : 'No past visits yet.'
          }
        />

        {items.map((entry) => (
          <Link key={entry.id} href={`/visit/${entry.id}`} asChild>
            <Pressable style={styles.card} android_ripple={pressable().android_ripple}>
              <View style={styles.cardTop}>
                <Text style={styles.token}>{entry.tokenLabel}</Text>
                <EntryStatusPill status={entry.status} />
              </View>
              <Text style={styles.doctor}>{entry.doctorName}</Text>
              <Text style={styles.meta}>
                {entry.departmentName} · {entry.hospitalName}
              </Text>
              <View style={styles.when}>
                <Icon name="calendar" size={13} color={theme.color.textMuted} />
                <Text style={styles.meta}>
                  {calendarDate(entry.scheduledStart)} · {istClock(entry.scheduledStart)}
                </Text>
              </View>
            </Pressable>
          </Link>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.canvas },
  tabs: {
    flexDirection: 'row',
    gap: theme.space[2],
    paddingHorizontal: theme.space[4],
    paddingVertical: theme.space[3],
    backgroundColor: theme.color.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.border,
  },
  tab: {
    paddingVertical: theme.space[2],
    paddingHorizontal: theme.space[4],
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.slate[100],
    // docs/Design.md 9: a tap target is never smaller than 44x44.
    minHeight: 44,
    justifyContent: 'center',
  },
  tabOn: { backgroundColor: theme.color.teal[100] },
  tabText: { ...theme.font.body, color: theme.color.textMuted },
  tabTextOn: { color: theme.color.teal[800], fontWeight: '600' },
  content: { padding: theme.space[4], gap: theme.space[3], paddingBottom: theme.space[10] },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    padding: theme.space[4],
    gap: theme.space[1],
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Tabular numerals so a column of token numbers does not jitter (docs/Design.md 3).
  token: { ...theme.font.h2, color: theme.color.primary, fontVariant: ['tabular-nums'] },
  doctor: { ...theme.font.h3, color: theme.color.text, marginTop: theme.space[1] },
  meta: { ...theme.font.caption, color: theme.color.textMuted },
  when: { flexDirection: 'row', alignItems: 'center', gap: theme.space[1], marginTop: theme.space[1] },
});
