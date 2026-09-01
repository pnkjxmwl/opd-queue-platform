import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Patient, SessionDetail } from '@opd/contracts';
import { useApi } from '../../../../lib/api';
import { Icon } from '../../../../lib/icon';
import { JoinButton, PresencePill, QueryState, SessionStatusPill } from '../../../../lib/discovery';
import { calendarDate, istRange, rupees } from '../../../../lib/format';
import { Avatar, Button, SectionLabel, pressable } from '../../../../lib/ui';
import { bookingStateFor, useMyActiveEntries } from '../../../../lib/visits';
import { useLiveSession } from '../../../../lib/realtime';
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
/**
 * The safety net behind the socket, not the way this screen stays current.
 *
 * Phase 7 replaced the ten-second timer with a push: `useLiveSession` subscribes to
 * this session's room and every command in it invalidates this query, so the numbers
 * move when the QUEUE moves rather than when a timer fires. The fetch itself is
 * unchanged, because docs/Rules.md 8 makes the REST snapshot the thing a client
 * reconciles against either way.
 *
 * A slow poll stays because a phone's socket dies in ways a phone does not notice -
 * a lift, a hospital basement, an OS that suspended the app. Ninety seconds is
 * invisible when the socket is healthy and is the difference between "briefly stale"
 * and "silently wrong" when it is not.
 */
const FALLBACK_POLL_MS = 90_000;

export default function Session() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const session = useApi<SessionDetail>(`/sessions/${id}`, true, FALLBACK_POLL_MS);
  const data = session.data;

  // Live for as long as this screen is open (P7-MOB-01). Unsubscribes on unmount, so
  // a patient browsing ten doctors does not end up listening to ten queues.
  useLiveSession(id);

  // What this account already holds here, and whether anyone is left to book for.
  // Both are server data; joining them is rendering, not a queue decision.
  const myBookings = useMyActiveEntries();
  const patients = useApi<Patient[]>('/patients');
  const mine = myBookings.bySession.get(id);
  const booking = bookingStateFor(mine);
  const bookedPatientIds = new Set((mine ?? []).map((entry) => entry.patientId));
  const unbookedProfiles = (patients.data ?? []).filter(
    (person) => !bookedPatientIds.has(person.id),
  ).length;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: data?.doctorName ?? 'Session' }} />

      <ScrollView
        contentContainerStyle={styles.content}
        // The timer covers the ordinary case; this is for the patient who wants to
        // know NOW, and it is the gesture they will try first regardless.
        refreshControl={
          <RefreshControl
            refreshing={session.isFetching && !session.isPending}
            onRefresh={() => void session.refetch()}
            tintColor={theme.color.primary}
            colors={[theme.color.primary]}
          />
        }
      >
        <QueryState
          pending={session.isPending}
          error={session.error}
          onRetry={() => void session.refetch()}
        />
        {data ? <SessionBody detail={data} /> : null}
      </ScrollView>

{/*
        docs/Design.md 9: the primary action stays thumb-reachable at the bottom.

        ONE container for every state. The "book for someone else" action used to sit
        in a second View below this bar, which read as two disconnected strips - and
        it also hit trap 24 (a `style` prop next to a spread `pressable()`), so it
        rendered with none of its own padding at all.
      */}
      {data ? (
        <View style={styles.bar}>
          {booking.kind === 'none' ? (
            // Nothing booked: the fee is the context, Join is the action.
            <View style={styles.barRow}>
              <View>
                <Text style={styles.barLabel}>Consultation fee</Text>
                <Text style={styles.fee}>{rupees(data.feePaise)}</Text>
              </View>
              <JoinButton
                registrationOpen={data.snapshot.registrationOpen}
                onJoin={() => router.push(`/join?sessionId=${id}`)}
              />
            </View>
          ) : (
            // Already holding a place: the token is the only thing they came back
            // for, so it gets the whole width rather than a chip in a corner.
            <Button
              title={
                booking.kind === 'reserved'
                  ? 'Finish payment'
                  : `View your token · ${booking.entry.tokenLabel}`
              }
              icon={booking.kind === 'reserved' ? 'clock' : 'check-circle'}
              onPress={() =>
                router.push(
                  booking.kind === 'reserved'
                    ? `/join?sessionId=${id}`
                    : `/visit/${booking.entry.id}`,
                )
              }
            />
          )}

          {/*
            Booking a SECOND patient into a session you are already in is allowed -
            the server's check is scoped to (session, patient), not to the account -
            so a family can hold two tokens. Shown only when there is genuinely
            someone left to book for AND the server still says registration is open,
            because an action that leads to a refusal is worse than no action.

            Only on this screen, never on the cards: a list has no room to explain a
            second action, and the card is itself a tap target.
          */}
          {booking.kind === 'booked' && unbookedProfiles > 0 && data.snapshot.registrationOpen ? (
            <Pressable
              onPress={() => router.push(`/join?sessionId=${id}`)}
              accessibilityRole="button"
              accessibilityLabel="Book this session for another patient"
              {...pressable(theme.radius.md)}
            >
              {/* Feedback on the Pressable, visuals on the View (trap 24). */}
              <View style={styles.secondary}>
                <Icon name="user-plus" size={16} color={theme.color.primary} />
                <Text style={styles.secondaryText}>
                  Book for someone else · {rupees(data.feePaise)}
                </Text>
              </View>
            </Pressable>
          ) : null}
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
    // A column, so the primary action and the quieter one below it read as one
    // surface rather than two stacked bars.
    paddingHorizontal: theme.space[4],
    paddingTop: theme.space[3],
    paddingBottom: theme.space[3],
    backgroundColor: theme.color.surface,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    gap: theme.space[3],
  },
  barRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space[2],
    // A hairline INSIDE the bar, so the two actions are visibly related but ranked.
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.border,
    paddingTop: theme.space[3],
    // docs/Design.md 9: 44x44 minimum, even for a quiet action.
    minHeight: 44,
  },
  secondaryText: { ...theme.font.label, color: theme.color.primary },
  barLabel: { ...theme.font.overline, color: theme.color.textMuted },
  fee: { ...theme.font.h1, color: theme.color.primary, fontVariant: ['tabular-nums'] },
});
