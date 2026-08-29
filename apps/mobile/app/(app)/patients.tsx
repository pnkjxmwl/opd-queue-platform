import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CreatePatientRequest, Patient, PatientRelation } from '@opd/contracts';
import { useAuth } from '../../lib/auth';
import { Button, ErrorNote, Field } from '../../lib/ui';
import { theme } from '../../theme';

const RELATIONS: PatientRelation[] = [
  'SELF',
  'SPOUSE',
  'MOTHER',
  'FATHER',
  'CHILD',
  'SIBLING',
  'OTHER',
];

export default function Patients() {
  const { authedFetch } = useAuth();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [relation, setRelation] = useState<PatientRelation>('SELF');
  const [formError, setFormError] = useState<string | null>(null);

  const patients = useQuery({
    queryKey: ['patients'],
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
      void queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const removePatient = useMutation({
    mutationFn: async (id: string) => {
      const res = await authedFetch(`/patients/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not remove this profile');
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['patients'] }),
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
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Family profiles' }} />

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Add a profile</Text>

        <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" />

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
                style={[styles.chip, selected && styles.chipSelected]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {label(r)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {formError && <ErrorNote message={formError} />}

        <Button title="Add profile" onPress={onAdd} pending={addPatient.isPending} />
      </View>

      <Text style={styles.sectionTitle}>Your profiles</Text>

      {patients.isPending && <Text style={styles.muted}>Loading…</Text>}
      {patients.isError && <ErrorNote message={patients.error.message} />}
      {patients.data?.length === 0 && (
        <Text style={styles.muted}>No profiles yet. Add yourself first.</Text>
      )}

      {patients.data?.map((p) => (
        <View key={p.id} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowName}>{p.name}</Text>
            <Text style={styles.muted}>{label(p.relation)}</Text>
          </View>
          <Pressable
            onPress={() => removePatient.mutate(p.id)}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${p.name}`}
            hitSlop={8}
          >
            <Text style={styles.remove}>Remove</Text>
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
  screen: { padding: theme.space[4], gap: theme.space[4] },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space[5],
    gap: theme.space[3],
  },
  cardTitle: { ...theme.font.h3, color: theme.color.text },
  sectionTitle: { ...theme.font.h3, color: theme.color.text },
  label: { ...theme.font.label, color: theme.color.text },
  muted: { ...theme.font.body, color: theme.color.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] },
  chip: {
    paddingHorizontal: theme.space[3],
    paddingVertical: theme.space[2],
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  chipSelected: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  chipText: { ...theme.font.caption, color: theme.color.textMuted },
  chipTextSelected: { color: '#FFFFFF' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space[4],
  },
  rowText: { gap: 2 },
  rowName: { ...theme.font.bodyLg, color: theme.color.text },
  remove: { ...theme.font.label, color: theme.color.danger.fg },
});
