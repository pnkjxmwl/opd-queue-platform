import { useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';
import type { Paginated, PublicDoctor } from '@opd/contracts';
import { useApi } from '../../../lib/api';
import { useCity } from '../../../lib/city';
import { MoreNote, PAGE, QueryState, Row } from '../../../lib/discovery';
import { Field } from '../../../lib/ui';
import { theme } from '../../../theme';

/**
 * Doctor search - the secondary browse path (docs/PRD.md 5.1). It exists to lead
 * back to a session, which is the only joinable unit, so every result navigates to
 * that doctor's profile and their sessions.
 *
 * Scoped to the chosen city, like home: a patient in Mumbai searching "Sharma"
 * means a Sharma they can actually reach today.
 */
export default function Doctors() {
  const params = useLocalSearchParams<{ q?: string }>();
  const router = useRouter();
  const { city } = useCity();
  const [q, setQ] = useState(params.q ?? '');

  const scope = city ? `city=${encodeURIComponent(city)}&` : '';
  const search = q.trim() ? `&q=${encodeURIComponent(q.trim())}` : '';
  const doctors = useApi<Paginated<PublicDoctor>>(`/doctors?${scope}limit=${PAGE}${search}`);

  return (
    <>
      <Stack.Screen options={{ title: 'Doctors' }} />
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        data={doctors.data?.items ?? []}
        keyExtractor={(doctor) => doctor.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <Field
              label="Doctor or speciality"
              value={q}
              onChangeText={setQ}
              placeholder="e.g. Sharma, cardiology"
              autoCapitalize="none"
              icon="search"
              helper={city ? `Searching in ${city}` : undefined}
            />
          </View>
        }
        renderItem={({ item }) => (
          <Row
            avatar={item.name}
            title={item.name}
            subtitle={[item.specialization ?? item.departmentName, item.hospitalName].join(' · ')}
            meta={item.hospitalCity}
            onPress={() => router.push({ pathname: '/doctor/[id]', params: { id: item.id } })}
          />
        )}
        ItemSeparatorComponent={Gap}
        ListEmptyComponent={
          <QueryState
            pending={doctors.isPending}
            error={doctors.error}
            isEmpty={doctors.isSuccess}
            emptyIcon="search"
            emptyText="No doctors match that. Try a name or a speciality."
            onRetry={() => void doctors.refetch()}
          />
        }
        ListFooterComponent={
          doctors.data ? (
            <MoreNote shown={doctors.data.items.length} total={doctors.data.total} />
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
  header: { marginBottom: theme.space[4] },
  gap: { height: theme.space[3] },
});
