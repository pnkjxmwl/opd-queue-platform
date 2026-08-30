import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CreatePatientRequest, Patient, PatientRelation } from '@opd/contracts';
import { useAuth } from '../../../lib/auth';
import { Icon } from '../../../lib/icon';
import { QueryState } from '../../../lib/discovery';
import { Avatar, Button, ErrorNote, Field, SectionLabel, pressable } from '../../../lib/ui';
import { theme } from '../../../theme';

const RELATIONS: PatientRelation[] = [
  'SELF',
  'SPOUSE',
  'MOTHER',
  'FATHER',
  'CHILD',
  'SIBLING',
  'OTHER',
];

/** The people this account books for (docs/PRD.md 6.1, family profiles). */
export default function Patients() {
  const { authedFetch } = useAuth();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [relation, setRelation] = useState<PatientRelation>('SELF');
  const [formError, setFormError] = useState<string | null>(null);

  // The key matches lib/api.ts's useApi('/patients'), so adding a profile here also
  // refreshes the greeting and avatar on home.
  const patients = useQuery({
    queryKey: ['/patients'],
    queryFn: async (): Promise<Patient[]> => {
      const res = await authedFetch('/patients');
      if (!res.ok) throw new Error('Could not load your profiles');
      return res.json() as Promise<Patient[]>;
    },
  });

  const addPatient = useMutation({
    mutationFn: async (body: CreatePatientRequest) => {
      const res = await authedFetch('/patients', { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) throw new Error('Could not add this profile');
      return res.json() as Promise<Patient>;
    },
    onSuccess: () => {
      setName('');
      setRelation('SELF');
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ['/patients'] });
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const removePatient = useMutation({
    mutationFn: async (id: string) => {
      const res = await authedFetch(`/patients/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not remove this profile');
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['/patients'] }),
    onError: (e: Error) => setFormError(e.message),
  });

  function onAdd() {
    if (!name.trim()) {
      setFormError('Enter a name');
      return;
    }
    addPatient.mutate({ name: name.trim(), relation });
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: 'Family profiles' }} />

      <View style={styles.card}>
        <SectionLabel>Add a profile</SectionLabel>

        <Field
          label="Name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          icon="user"
        />

        <Text style={styles.label}>Relation</Text>
        <View style={styles.chips}>
          {RELATIONS.map((r) => {
            const selected = r === relation;
            return (
              <Pressable
                key={r}
                onPress={() => setRelation(r)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                {...pressable(theme.radius.full)}
              >
                <View style={[styles.chip, selected && styles.chipSelected]}>
                  {selected ? <Icon name="check" size={14} color="#FFFFFF" /> : null}
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {label(r)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {formError && <ErrorNote message={formError} />}

        <Button
          title="Add profile"
          icon="plus"
          onPress={onAdd}
          pending={addPatient.isPending}
        />
      </View>

      <SectionLabel>Your profiles</SectionLabel>

      <QueryState
        pending={patients.isPending}
        error={patients.error}
        isEmpty={patients.isSuccess && patients.data.length === 0}
        emptyIcon="users"
        emptyText="No profiles yet. Add yourself first."
        onRetry={() => void patients.refetch()}
      />

      {patients.data?.map((p) => (
        <View key={p.id} style={styles.row}>
          <Avatar name={p.name} />
          <View style={styles.rowText}>
            <Text style={styles.rowName}>{p.name}</Text>
            <Text style={styles.muted}>{label(p.relation)}</Text>
          </View>
          <Pressable
            onPress={() => removePatient.mutate(p.id)}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${p.name}`}
            hitSlop={8}
            {...pressable(theme.radius.full)}
          >
            <View style={styles.remove}>
              <Icon name="trash-2" size={18} color={theme.color.danger.fg} />
            </View>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

/** SELF -> "Myself", MOTHER -> "Mother". */
function label(relation: PatientRelation): string {
  if (relation === 'SELF') return 'Myself';
  return relation.charAt(0) + relation.slice(1).toLowerCase();
}

const styles = StyleSheet.create({
  screen: { backgroundColor: theme.color.canvas },
  content: { padding: theme.space[4], gap: theme.space[3], paddingBottom: theme.space[8] },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.space[4],
    gap: theme.space[3],
    ...theme.elevation.sm,
  },
  label: { ...theme.font.label, color: theme.color.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[1],
    // 36 tall inside a row that keeps 44px of tappable area via the parent padding.
    height: 36,
    paddingHorizontal: theme.space[3],
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  chipSelected: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  chipText: { ...theme.font.label, color: theme.color.text },
  chipTextSelected: { color: '#FFFFFF' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[3],
    minHeight: 64,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.space[4],
    paddingVertical: theme.space[3],
    ...theme.elevation.sm,
  },
  rowText: { flex: 1, gap: 2 },
  rowName: { ...theme.font.h3, color: theme.color.text },
  muted: { ...theme.font.body, color: theme.color.textMuted },
  remove: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.full,
  },
});
