import { useState } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { HospitalCard, Paginated, Patient, PublicDoctor } from '@opd/contracts';
import { useApi } from '../../../lib/api';
import { useCity } from '../../../lib/city';
import { Icon } from '../../../lib/icon';
import { MoreNote, PAGE, QueryState, Row } from '../../../lib/discovery';
import { Avatar, Button, Screen, SectionLabel, pressable } from '../../../lib/ui';
import { theme } from '../../../theme';

/**
 * Home. The city is remembered (lib/city.tsx), so this opens straight onto the
 * hospitals in it rather than asking again every visit - docs/PRD.md 6.1 still
 * describes the same flow, the choice is just persisted.
 *
 * The search box searches BOTH doctors and hospitals. A box that only filtered
 * hospitals would return nothing for "Sharma" and read as broken; both endpoints
 * already take `city` and `q` and are already tested.
 */
export default function Home() {
  const router = useRouter();
  const { city, ready } = useCity();
  const [q, setQ] = useState('');
  const query = q.trim();

  // The SELF profile is where a real name lives; it also supplies the avatar
  // initials. One query, one cache key, shared with the Profile tab.
  const patients = useApi<Patient[]>('/patients');
  const self = patients.data?.find((p) => p.relation === 'SELF');

  const scope = city ? `city=${encodeURIComponent(city)}` : '';
  const search = query ? `&q=${encodeURIComponent(query)}` : '';

  const hospitals = useApi<Paginated<HospitalCard>>(
    `/hospitals?${scope}&limit=${PAGE}${search}`,
    ready && city !== null,
  );
  // Only fetched while searching - an empty box is a hospital list, not a doctor list.
  const doctors = useApi<Paginated<PublicDoctor>>(
    `/doctors?${scope}&limit=3${search}`,
    ready && city !== null && query.length > 0,
  );

  const header = (
    <View style={styles.header}>
      <View style={styles.topRow}>
        <Pressable
          onPress={() => router.push('/location')}
          accessibilityRole="button"
          accessibilityLabel={city ? `Change city, currently ${city}` : 'Choose your city'}
          {...pressable(theme.radius.full)}
        >
          <View style={styles.cityChip}>
            <Icon name="map-pin" size={16} color={theme.color.primary} />
            <Text style={styles.cityText}>{city ?? 'Choose city'}</Text>
            <Icon name="chevron-down" size={16} color={theme.color.primary} />
          </View>
        </Pressable>
        {/* Crossing to the Profile TAB, not pushing a screen onto this stack:
            expo-router switches tabs for a route that belongs to another one. */}
        <Pressable
          onPress={() => router.push('/profile')}
          accessibilityRole="button"
          accessibilityLabel="Your profile"
          hitSlop={8}
          {...pressable(theme.radius.full)}
        >
          <Avatar name={self?.name ?? '?'} />
        </Pressable>
      </View>

      <Text style={styles.greeting}>
        {greeting()}
        {self ? `, ${self.name.split(' ')[0]}` : ''}
      </Text>

      <View style={styles.search}>
        <Icon name="search" size={18} color={theme.color.textDisabled} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Doctors, hospitals, specialities"
          placeholderTextColor={theme.color.textDisabled}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
          accessibilityLabel="Search doctors and hospitals"
        />
        {query ? (
          <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Clear search">
            <Icon name="x" size={18} color={theme.color.textDisabled} />
          </Pressable>
        ) : null}
      </View>

      {query && doctors.data && doctors.data.total > 0 ? (
        <View style={styles.doctorBlock}>
          <SectionLabel>Doctors</SectionLabel>
          {doctors.data.items.map((doctor) => (
            <Row
              key={doctor.id}
              avatar={doctor.name}
              title={doctor.name}
              subtitle={`${doctor.specialization ?? doctor.departmentName} · ${doctor.hospitalName}`}
              onPress={() => router.push({ pathname: '/doctor/[id]', params: { id: doctor.id } })}
            />
          ))}
          {doctors.data.total > doctors.data.items.length ? (
            <Row
              icon="users"
              title={`See all ${doctors.data.total} doctors`}
              onPress={() => router.push({ pathname: '/doctors', params: { q: query } })}
            />
          ) : null}
        </View>
      ) : null}

      <SectionLabel>{query ? 'Hospitals' : `Hospitals in ${city ?? ''}`}</SectionLabel>
    </View>
  );

  // First run: no city stored. A prompt, deliberately NOT an automatic redirect -
  // the root layout's auth gate already redirects in an effect and a second one is
  // how a navigation loop starts.
  if (ready && city === null) {
    return (
      <Screen style={styles.prompt}>
        <View style={styles.promptIcon}>
          <Icon name="map-pin" size={30} color={theme.color.primary} />
        </View>
        <Text style={styles.promptTitle}>Choose your city</Text>
        <Text style={styles.promptBody}>
          We&apos;ll show the hospitals running OPD near you today.
        </Text>
        <View style={styles.promptButton}>
          <Button title="Select city" icon="map-pin" onPress={() => router.push('/location')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        contentContainerStyle={styles.content}
        data={hospitals.data?.items ?? []}
        keyExtractor={(hospital) => hospital.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <Row
            avatar={item.name}
            // Passing photoUrl - even when it is null - opts this into the taller
            // card with an 88px photograph. A hospital is the biggest choice on this
            // screen and was rendering in the same box as a department line.
            photoUrl={item.photoUrl}
            title={item.name}
            subtitle={item.area ?? item.city}
            badge={
              item.todaySessionCount === 0
                ? { label: 'No OPD today', tone: 'neutral', icon: 'moon' }
                : {
                    label: `${item.todaySessionCount} OPD today`,
                    tone: 'success',
                    icon: 'calendar',
                  }
            }
            onPress={() => router.push({ pathname: '/hospital/[id]', params: { id: item.id } })}
          />
        )}
        ItemSeparatorComponent={Gap}
        ListEmptyComponent={
          <QueryState
            pending={!ready || hospitals.isPending}
            error={hospitals.error}
            isEmpty={hospitals.isSuccess}
            emptyIcon={query ? 'search' : 'home'}
            emptyText={
              query
                ? `Nothing in ${city} matches “${query}”.`
                : `No hospitals are listed in ${city} yet.`
            }
            // Four, because Mumbai has four - the placeholder should be the shape of
            // the answer, not an arbitrary count that makes the page resize.
            skeletonRows={4}
            onRetry={() => void hospitals.refetch()}
          />
        }
        ListFooterComponent={
          hospitals.data ? (
            <MoreNote shown={hospitals.data.items.length} total={hospitals.data.total} />
          ) : null
        }
      />
    </Screen>
  );
}

const Gap = () => <View style={styles.gap} />;

/** docs/Design.md 11: calm and human. Local device time is the right clock here. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const styles = StyleSheet.create({
  content: { padding: theme.space[4], paddingBottom: theme.space[8] },
  header: { gap: theme.space[4], marginBottom: theme.space[3] },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[1],
    height: 40,
    paddingHorizontal: theme.space[3],
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.teal[50],
  },
  cityText: { ...theme.font.label, color: theme.color.primary },
  greeting: { ...theme.font.h2, color: theme.color.text },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[2],
    height: 48,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surface,
    paddingHorizontal: theme.space[4],
    ...theme.elevation.sm,
  },
  searchInput: { flex: 1, ...theme.font.body, color: theme.color.text },

  doctorBlock: { gap: theme.space[2] },
  gap: { height: theme.space[3] },

  prompt: { alignItems: 'center', justifyContent: 'center', padding: theme.space[6], gap: theme.space[3] },
  promptIcon: {
    width: 64,
    height: 64,
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.teal[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptTitle: { ...theme.font.h1, color: theme.color.text },
  promptBody: { ...theme.font.body, color: theme.color.textMuted, textAlign: 'center' },
  promptButton: { alignSelf: 'stretch', marginTop: theme.space[2] },
});
