import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { HospitalDetail, Paginated, PublicDepartment } from '@opd/contracts';
import { useApi } from '../../../../lib/api';
import { Icon } from '../../../../lib/icon';
import { MoreNote, PAGE, QueryState, Row } from '../../../../lib/discovery';
import { Avatar, SectionLabel } from '../../../../lib/ui';
import { theme } from '../../../../theme';

/** A hospital and the departments running OPD there. */
export default function Hospital() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const hospital = useApi<HospitalDetail>(`/hospitals/${id}`);
  const departments = useApi<Paginated<PublicDepartment>>(
    `/departments?hospitalId=${id}&limit=${PAGE}`,
  );

  return (
    <>
      <Stack.Screen options={{ title: hospital.data?.name ?? 'Hospital' }} />
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        data={departments.data?.items ?? []}
        keyExtractor={(department) => department.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <QueryState
              pending={hospital.isPending}
              error={hospital.error}
              onRetry={() => void hospital.refetch()}
            />
            {hospital.data ? (
              <View style={styles.about}>
                <Avatar name={hospital.data.name} size={56} />
                <Text style={styles.title}>{hospital.data.name}</Text>
                <View style={styles.line}>
                  <Icon name="map-pin" size={14} color={theme.color.textMuted} />
                  <Text style={styles.muted}>
                    {[hospital.data.area, hospital.data.city].filter(Boolean).join(', ')}
                  </Text>
                </View>
                {hospital.data.address ? (
                  <View style={styles.line}>
                    <Icon name="navigation" size={14} color={theme.color.textMuted} />
                    <Text style={styles.muted}>{hospital.data.address}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            <SectionLabel>Departments</SectionLabel>
          </View>
        }
        renderItem={({ item }) => (
          <Row
            icon="activity"
            title={item.name}
            badge={
              item.todaySessionCount === 0
                ? { label: 'No OPD today', tone: 'neutral', icon: 'moon' }
                : {
                    label: `${item.todaySessionCount} OPD today`,
                    tone: 'success',
                    icon: 'calendar',
                  }
            }
            onPress={() => router.push({ pathname: '/department/[id]', params: { id: item.id } })}
          />
        )}
        ItemSeparatorComponent={Gap}
        ListEmptyComponent={
          <QueryState
            pending={departments.isPending}
            error={departments.error}
            isEmpty={departments.isSuccess}
            emptyIcon="activity"
            emptyText="This hospital has no departments listed yet."
            onRetry={() => void departments.refetch()}
          />
        }
        ListFooterComponent={
          departments.data ? (
            <MoreNote shown={departments.data.items.length} total={departments.data.total} />
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
  muted: { ...theme.font.body, color: theme.color.textMuted, flex: 1 },
  gap: { height: theme.space[3] },
});
