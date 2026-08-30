import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SessionDetail } from '@opd/contracts';
import { useApi } from '../../../../lib/api';
import { Icon } from '../../../../lib/icon';
import { JoinButton, PresencePill, QueryState, SessionStatusPill } from '../../../../lib/discovery';
import { calendarDate, istRange, rupees } from '../../../../lib/format';
import { Avatar, SectionLabel } from '../../../../lib/ui';
import { theme } from '../../../../theme';

/**
 * One session in full - the last read-only screen before joining exists (Phase 5).
 *
 * Everything shown here is decided by the server. `registrationOpen` in particular
 * is never recomputed on the phone (docs/Rules.md 1, docs/CLAUDE.md 9).
 *
 * This screen is a LEAF: it links nowhere. It briefly carried a "see this doctor's
 * other sessions" link back to /doctor/[id], which made session <-> doctor the only
 * cycle in the app - every round trip pushed two more screens, so a user who
 * followed it a few times needed a dozen taps to get back out.
 *
 * Deleted rather than bounded, because the link was also redundant: a Doctor has
 * exactly one departmentId, and a session's department is copied from its doctor
 * (apps/api/src/modules/sessions/sessions.service.ts), so that doctor's sessions are
 * always a SUBSET of the department list the user came from. It offered a cycle and
 * no information. The navigation graph is now a DAG.
 */
export default function Session() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useApi<SessionDetail>(`/sessions/${id}`);
  const data = session.data;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: data?.doctorName ?? 'Session' }} />

      <ScrollView contentContainerStyle={styles.content}>
        <QueryState
          pending={session.isPending}
          error={session.error}
          onRetry={() => void session.refetch()}
        />
        {data ? <SessionBody detail={data} /> : null}
      </ScrollView>

      {/* docs/Design.md 9: the primary action stays thumb-reachable at the bottom. */}
      {data ? (
        <View style={styles.bar}>
          <View>
            <Text style={styles.barLabel}>Consultation fee</Text>
            <Text style={styles.fee}>{rupees(data.feePaise)}</Text>
          </View>
          <JoinButton registrationOpen={data.snapshot.registrationOpen} />
        </View>
      ) : null}
    </View>
  );
}

function SessionBody({ detail }: { detail: SessionDetail }) {
  const { snapshot } = detail;

  return (
    <>
      <View style={styles.card}>
        <View style={styles.head}>
          <Avatar name={detail.doctorName} size={52} />
          <View style={styles.headText}>
            <Text style={styles.doctor}>{detail.doctorName}</Text>
            <Text style={styles.muted}>
              {detail.doctorSpecialization ?? detail.departmentName}
            </Text>
          </View>
        </View>

        <View style={styles.pills}>
          <SessionStatusPill status={detail.status} />
          <PresencePill presence={detail.doctorPresence} />
        </View>

        <View style={styles.line}>
          <Icon name="calendar" size={16} color={theme.color.textMuted} />
          <Text style={styles.muted}>
            {calendarDate(detail.date)} · {istRange(detail.scheduledStart, detail.scheduledEnd)}
          </Text>
        </View>
        {detail.isSubstitute ? (
          <View style={styles.line}>
            <Icon name="repeat" size={16} color={theme.color.textMuted} />
            <Text style={styles.muted}>
              Covering for the doctor this session was booked with.
            </Text>
          </View>
        ) : null}
      </View>

      <SectionLabel>Live queue</SectionLabel>
      <View style={styles.card}>
        <Line label="Now serving" value={snapshot.nowServingToken ?? '—'} />
        {/* docs/PRD.md 7.3: two numbers, because "8 waiting" would be a half-truth
            when five of them are still at home. */}
        <Line label="Checked in and waiting" value={String(snapshot.checkedInCount)} />
        <Line label="Booked, not arrived" value={String(snapshot.bookedNotArrivedCount)} />
        <Line
          label="You would be seen"
          value={
            snapshot.joinNowEtaFrom && snapshot.joinNowEtaTo
              ? `~${istRange(snapshot.joinNowEtaFrom, snapshot.joinNowEtaTo)}`
              : 'Not available yet'
          }
        />
        <Text style={styles.footnote}>
          Live queue numbers and wait-time estimates switch on with the queue engine.
        </Text>
      </View>

      <SectionLabel>Where</SectionLabel>
      <View style={styles.card}>
        <View style={styles.line}>
          <Icon name="home" size={16} color={theme.color.textMuted} />
          <Text style={styles.body}>{detail.hospitalName}</Text>
        </View>
        {detail.hospitalAddress ? (
          <View style={styles.line}>
            <Icon name="navigation" size={16} color={theme.color.textMuted} />
            <Text style={styles.muted}>{detail.hospitalAddress}</Text>
          </View>
        ) : null}
        {detail.hospitalArea ? (
          <View style={styles.line}>
            <Icon name="map-pin" size={16} color={theme.color.textMuted} />
            <Text style={styles.muted}>{detail.hospitalArea}</Text>
          </View>
        ) : null}
        <Text style={styles.footnote}>
          {detail.doctorName} usually spends about {detail.doctorDefaultConsultMins} minutes per
          patient.
        </Text>
      </View>
    </>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statLine}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.canvas },
  content: { padding: theme.space[4], gap: theme.space[3], paddingBottom: theme.space[6] },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.space[4],
    gap: theme.space[3],
    ...theme.elevation.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: theme.space[3] },
  headText: { flex: 1, gap: 2 },
  doctor: { ...theme.font.h2, color: theme.color.text },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] },
  line: { flexDirection: 'row', alignItems: 'center', gap: theme.space[2] },
  body: { ...theme.font.bodyLg, color: theme.color.text, flex: 1 },
  muted: { ...theme.font.body, color: theme.color.textMuted, flex: 1 },
  footnote: { ...theme.font.caption, color: theme.color.textMuted },
  statLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Tabular figures: these numbers change live in Phase 7 and must not jitter.
  lineValue: { ...theme.font.h3, color: theme.color.text, fontVariant: ['tabular-nums'] },

  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space[4],
    paddingTop: theme.space[3],
    paddingBottom: theme.space[3],
    backgroundColor: theme.color.surface,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  barLabel: { ...theme.font.overline, color: theme.color.textMuted },
  fee: { ...theme.font.h1, color: theme.color.primary, fontVariant: ['tabular-nums'] },
});
