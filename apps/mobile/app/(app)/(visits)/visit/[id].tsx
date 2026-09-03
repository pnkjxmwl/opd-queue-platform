import { useEffect, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type { CancelEntryResponse, MyQueueEntry, Paginated } from '@opd/contracts';
import { useApi, useApiPost } from '../../../../lib/api';
import { QueryState } from '../../../../lib/discovery';
import {
  EntryStatusPill,
  MY_ACTIVE_ENTRIES,
  holdRemaining,
  nextStepFor,
} from '../../../../lib/visits';
import { Button, ErrorNote, SectionLabel } from '../../../../lib/ui';
import { useLiveSession } from '../../../../lib/realtime';
import { LiveState } from '../../../../lib/discovery';
import { calendarDate, istClock, istRange, rupees } from '../../../../lib/format';
import { theme } from '../../../../theme';

/**
 * The token card - the hero after joining (docs/Design.md 5.6).
 *
 * Every number on it comes from the server. The two "ahead" counts are the honest
 * two-number model: people physically here and ahead of you, and people booked
 * ahead who may or may not turn up. Nothing here recomputes a queue position
 * (docs/CLAUDE.md 9).
 *
 * Phase 7 made it live. `entry.updated` arrives on this account's own private room
 * the instant their booking moves - called, skipped, cancelled - and
 * `useLiveSession` keeps the queue numbers and the ETA window moving with the room
 * they are waiting in. The poll below is now only the safety net for a socket that
 * died without saying so, which on a phone is an ordinary Tuesday.
 */
const FALLBACK_POLL_MS = 90_000;

export default function TokenCard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  // There is no GET /me/queue-entries/:id: the active list is small and already
  // carries every field this screen needs, so one cached request serves both
  // screens rather than adding an endpoint for a single reader.
  const query = useApi<Paginated<MyQueueEntry>>(MY_ACTIVE_ENTRIES, true, FALLBACK_POLL_MS);
  const past = useApi<Paginated<MyQueueEntry>>('/me/queue-entries?scope=past&limit=50');
  const entry =
    query.data?.items.find((e) => e.id === id) ?? past.data?.items.find((e) => e.id === id) ?? null;

  // Watch the queue this token is in, so the ETA and "ahead of you" move with it.
  const { connected } = useLiveSession(entry?.sessionId);

  const cancel = useApiPost<{ reason?: string }, CancelEntryResponse>(`/queue-entries/${id}/cancel`);

  // A ticking clock for the hold countdown. One second is the smallest unit shown.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (entry?.reservationExpiresAt == null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [entry?.reservationExpiresAt]);

  const onCancel = () => {
    if (entry === null) return;
    Alert.alert(
      'Cancel this booking?',
      entry.refundPctIfCancelledNow > 0
        ? `You will be refunded ${entry.refundPctIfCancelledNow}% of ${rupees(entry.feePaise)}. Refunds take a few working days.`
        : 'This booking is past the free cancellation window, so no refund is due.',
      [
        { text: 'Keep booking', style: 'cancel' },
        {
          text: 'Cancel booking',
          style: 'destructive',
          onPress: () =>
            cancel.mutate(
              {},
              {
                onSuccess: () => {
                  void query.refetch();
                  void past.refetch();
                  router.back();
                },
              },
            ),
        },
      ],
    );
  };

  const hold = entry ? holdRemaining(entry.reservationExpiresAt, now) : null;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: entry?.tokenLabel ?? 'Your token' }} />
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
          isEmpty={!query.isPending && entry === null}
          emptyText="This booking is no longer available."
        />

        {entry !== null && (
          <>
            <View style={styles.card}>
              <Text style={styles.overline}>YOUR TOKEN</Text>
              <Text style={styles.token}>{entry.tokenLabel}</Text>
              <EntryStatusPill status={entry.status} />
              {/*
                The most important place in the app for this. Every number below -
                the token, both "ahead" counts, the ETA window - is only true while
                updates are arriving. A dropped socket freezes them rather than
                clearing them, so a patient reading "2 checked in ahead" on a phone
                that lost signal will sit down and wait for a turn that has already
                passed. Nothing is rendered while connected.
              */}
              <LiveState connected={connected} />

              {entry.checkInCode !== null ? (
                <View style={styles.qr}>
                  <QRCode value={entry.checkInCode} size={168} backgroundColor="white" />
                  <Text style={styles.qrHint}>Show this at reception to check in</Text>
                </View>
              ) : (
                <Text style={styles.qrHint}>
                  {hold !== null
                    ? `Your place is held for ${hold}. Your QR code appears once payment is confirmed.`
                    : 'Your QR code appears once payment is confirmed.'}
                </Text>
              )}
            </View>

            <View style={styles.card}>
              <SectionLabel>Where you are</SectionLabel>
              <Stat label="Now serving" value={entry.nowServingToken ?? 'Not started'} />
              <Stat label="Checked in ahead" value={String(entry.checkedInAheadCount)} />
              <Stat label="Also booked ahead" value={String(entry.bookedAheadCount)} />
              <Stat
                label="Seen by"
                // Phase 7 fills the window. Saying nothing is better than a guess.
                value={
                  entry.etaFrom !== null && entry.etaTo !== null
                    ? `~${istRange(entry.etaFrom, entry.etaTo)}`
                    : 'Estimate coming soon'
                }
              />
              <Text style={styles.nextStep}>{nextStepFor(entry)}</Text>
            </View>

            <View style={styles.card}>
              <SectionLabel>Appointment</SectionLabel>
              <Stat label="Doctor" value={entry.doctorName} />
              <Stat label="Department" value={entry.departmentName} />
              <Stat label="Hospital" value={entry.hospitalName} />
              <Stat label="Date" value={calendarDate(entry.scheduledStart)} />
              <Stat label="Session" value={istClock(entry.scheduledStart)} />
              <Stat label="Patient" value={entry.patientName} />
              <Stat label="Fee" value={rupees(entry.feePaise)} />
            </View>

            {cancel.error !== null && <ErrorNote message={cancel.error.message} />}

            {entry.cancellable && (
              <Button
                title="Cancel booking"
                onPress={onCancel}
                pending={cancel.isPending}
                variant="ghost"
              />
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.canvas },
  content: { padding: theme.space[4], gap: theme.space[3], paddingBottom: theme.space[10] },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    padding: theme.space[5],
    gap: theme.space[2],
    alignItems: 'stretch',
  },
  overline: { ...theme.font.caption, color: theme.color.textMuted, letterSpacing: 1, textAlign: 'center' },
  token: {
    ...theme.font.display,
    color: theme.color.teal[700],
    textAlign: 'center',
    // The number must not shift as it changes (docs/Design.md 3).
    fontVariant: ['tabular-nums'],
  },
  qr: { alignItems: 'center', gap: theme.space[3], marginTop: theme.space[3] },
  qrHint: { ...theme.font.caption, color: theme.color.textMuted, textAlign: 'center' },
  stat: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.space[4] },
  statLabel: { ...theme.font.body, color: theme.color.textMuted, flexShrink: 1 },
  statValue: {
    ...theme.font.body,
    color: theme.color.text,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
    textAlign: 'right',
  },
  nextStep: {
    ...theme.font.body,
    color: theme.color.text,
    backgroundColor: theme.color.teal[50],
    borderRadius: theme.radius.md,
    padding: theme.space[3],
    marginTop: theme.space[2],
  },
});
