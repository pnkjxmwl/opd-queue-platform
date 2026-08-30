import { Stack, useRouter } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { City, Paginated } from '@opd/contracts';
import { useApi } from '../../../lib/api';
import { useCity } from '../../../lib/city';
import { MoreNote, PAGE, QueryState, Row } from '../../../lib/discovery';
import { theme } from '../../../theme';

/**
 * Pick the city to browse. Reached on first run and from the chip on home.
 *
 * The list is server-derived (GET /cities counts only listable hospitals), so a
 * city with nothing to show never appears and the choice can never be a dead end.
 */
export default function Location() {
  const router = useRouter();
  const { city, setCity } = useCity();
  const cities = useApi<Paginated<City>>(`/cities?limit=${PAGE}`);

  async function choose(name: string) {
    await setCity(name);
    // back(), not push('/'): home is already underneath, and pushing would leave a
    // second copy of it on the stack.
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Your city' }} />
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        data={cities.data?.items ?? []}
        keyExtractor={(item) => item.name}
        ListHeaderComponent={
          <Text style={styles.intro}>
            Pick where you want to be seen. You can change this any time from the home screen.
          </Text>
        }
        renderItem={({ item }) => (
          <Row
            icon={item.name === city ? 'check' : 'map-pin'}
            title={item.name}
            subtitle={`${item.hospitalCount} hospital${item.hospitalCount === 1 ? '' : 's'}`}
            onPress={() => void choose(item.name)}
          />
        )}
        ItemSeparatorComponent={Gap}
        ListEmptyComponent={
          <QueryState
            pending={cities.isPending}
            error={cities.error}
            isEmpty={cities.isSuccess}
            emptyIcon="map-pin"
            emptyText="No hospitals are listed yet. Please check back soon."
            onRetry={() => void cities.refetch()}
          />
        }
        ListFooterComponent={
          cities.data ? (
            <MoreNote shown={cities.data.items.length} total={cities.data.total} />
          ) : null
        }
      />
    </>
  );
}

const Gap = () => <View style={styles.gap} />;

const styles = StyleSheet.create({
  list: { backgroundColor: theme.color.canvas },
  content: { padding: theme.space[4] },
  intro: { ...theme.font.body, color: theme.color.textMuted, marginBottom: theme.space[4] },
  gap: { height: theme.space[3] },
});
