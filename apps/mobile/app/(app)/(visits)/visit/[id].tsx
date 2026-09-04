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
import { Button, Card, ErrorNote, KeyValue } from '../../../../lib/ui';
import { Icon } from '../../../../lib/icon';
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
 *
 * **What the redesign changed.** This screen answers three questions in a fixed
 * order - *what is my token*, *when will I be seen*, *what do I do now* - and it
 * used to answer them at the same weight as "Fee" and "Department". Seven
 * label/value rows in a flat list, with the ETA fourth. Now:
 *
 *   1. the token, its status and whether the screen is still live;
 *   2. the two numbers that change - the ETA window and who is being seen - as
 *      figures rather than as rows;
 *   3. the instruction, in a box, because it is the only sentence on the screen that
 *      tells the patient to do something;
 *   4. the QR, sized to be scanned across a reception desk;
 *   5. everything that never changes, last.
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
            {/* ------------------------------------------------------------
                1. The token. The largest thing on the largest screen in the
                app, on a teal ground so it is findable in a pocket at arm's
                length in a corridor.
            ------------------------------------------------------------- */}
            <View style={styles.hero}>
              <Text style={styles.overline}>YOUR TOKEN</Text>
              <Text style={styles.token}>{entry.tokenLabel}</Text>
              <Text style={styles.heroWho}>
                {entry.patientName} · {entry.doctorName}
              </Text>
              <View style={styles.heroPills}>
                <EntryStatusPill status={entry.status} />
                {/*
                  The most important place in the app for this. Every number below -
                  both "ahead" counts and the ETA window - is only true while updates
                  are arriving. A dropped socket freezes them rather than clearing
                  them, so a patient reading "2 checked in ahead" on a phone that lost
                  signal will sit down and wait for a turn that has already passed.
                  Nothing is rendered while connected.
                */}
                <LiveState connected={connected} />
              </View>
            </View>

            {/* ------------------------------------------------------------
                2. The two figures that move, as figures. Then the counts that
                explain them, and the instruction that follows from both.
            ------------------------------------------------------------- */}
            <Card title="Where you are">
              <View style={styles.figures}>
                <Figure
                  icon="clock"
                  label="Seen by"
                  // Phase 7 fills the window. Saying nothing is better than a guess.
                  value={
                    entry.etaFrom !== null && entry.etaTo !== null
                      ? `~${istRange(entry.etaFrom, entry.etaTo)}`
                      : 'Coming soon'
                  }
                />
                <View style={styles.figureRule} />
                <Figure
                  icon="activity"
                  label="Now serving"
                  value={entry.nowServingToken ?? 'Not started'}
                />
              </View>

              <View style={styles.aheadRow}>
                <Ahead count={entry.checkedInAheadCount} label="checked in ahead" />
                <Ahead count={entry.bookedAheadCount} label="also booked ahead" />
              </View>

              <View style={styles.nextStep}>
                <Icon name="navigation" size={16} color={theme.color.teal[700]} />
                <Text style={styles.nextStepText}>{nextStepFor(entry)}</Text>
              </View>
            </Card>

            {/* ------------------------------------------------------------
                3. The QR, in a frame that says "hold this up", not floating in
                a card of statistics.
            ------------------------------------------------------------- */}
            <Card title="Checking in">
              {entry.checkInCode !== null ? (
                <View style={styles.qrWrap}>
                  <View style={styles.qr}>
                    <QRCode value={entry.checkInCode} size={172} backgroundColor="white" />
                  </View>
                  <Text style={styles.qrHint}>Show this at reception to check in</Text>
                </View>
              ) : (
                <View style={styles.pending}>
                  <Icon name="clock" size={18} color={theme.color.warning.fg} />
                  <Text style={styles.pendingText}>
                    {hold !== null
                      ? `Your place is held for ${hold}. Your QR code appears once payment is confirmed.`
                      : 'Your QR code appears once payment is confirmed.'}
                  </Text>
                </View>
              )}
            </Card>

            {/* ------------------------------------------------------------
                4. Everything that does not change, last, and quietly.
            ------------------------------------------------------------- */}
            <Card title="Appointment">
              <KeyValue label="Department" value={entry.departmentName} />
              <KeyValue label="Hospital" value={entry.hospitalName} />
              <KeyValue label="Date" value={calendarDate(entry.scheduledStart)} />
              <KeyValue label="Session starts" value={istClock(entry.scheduledStart)} />
              <KeyValue label="Fee" value={rupees(entry.feePaise)} />
            </Card>

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

/** One live figure: an icon, what it is, and the value in tabular digits. */
function Figure({
  icon,
  label,
  value,
}: {
  icon: 'clock' | 'activity';
  label: string;
  value: string;
}) {
  return (
    <View style={styles.figure}>
      <View style={styles.figureHead}>
        <Icon name={icon} size={13} color={theme.color.textMuted} />
        <Text style={styles.figureLabel}>{label}</Text>
      </View>
      <Text style={styles.figureValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
    </View>
  );
}

/**
 * One of the two "ahead of you" counts.
 *
 * They stay separate and stay labelled: docs/PRD.md is explicit that a patient is
 * told how many are physically here AND how many merely booked, because collapsing
 * them into one number is the lie that makes an ETA feel arbitrary.
 */
function Ahead({ count, label }: { count: number; label: string }) {
  return (
    <View style={styles.ahead}>
      <Text style={styles.aheadCount}>{count}</Text>
      <Text style={styles.aheadLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.canvas },
  content: { padding: theme.space[4], gap: theme.space[3], paddingBottom: theme.space[10] },

  /*
    The one place in the app with a filled brand surface.

    docs/Design.md 2.5 rules out gradients and decorative colour, and this is not
    that: the token is the single object the whole product exists to hand over, and a
    patient holding a phone up at a reception desk needs it to be the thing their eye
    lands on. Colour here marks the object, which is exactly the job §2.5 leaves it.
  */
  hero: {
    alignItems: 'center',
    gap: theme.space[2],
    backgroundColor: theme.color.teal[50],
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.teal[200],
    paddingVertical: theme.space[6],
    paddingHorizontal: theme.space[4],
  },
  overline: { ...theme.font.overline, color: theme.color.teal[700] },
  token: {
    ...theme.font.display,
    fontSize: 52,
    lineHeight: 58,
    color: theme.color.teal[800],
    textAlign: 'center',
    // The number must not shift as it changes (docs/Design.md 3).
    fontVariant: ['tabular-nums'],
  },
  heroWho: { ...theme.font.body, color: theme.color.teal[800], textAlign: 'center' },
  heroPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: theme.space[2],
    marginTop: theme.space[1],
  },

  figures: { flexDirection: 'row', alignItems: 'stretch', gap: theme.space[3] },
  figure: { flex: 1, gap: theme.space[1] },
  figureRule: { width: StyleSheet.hairlineWidth, backgroundColor: theme.color.border },
  figureHead: { flexDirection: 'row', alignItems: 'center', gap: theme.space[1] },
  figureLabel: { ...theme.font.caption, color: theme.color.textMuted },
  figureValue: {
    ...theme.font.h2,
    color: theme.color.text,
    fontVariant: ['tabular-nums'],
  },

  aheadRow: {
    flexDirection: 'row',
    gap: theme.space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.border,
    paddingTop: theme.space[3],
  },
  ahead: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] },
  aheadCount: {
    ...theme.font.h2,
    color: theme.color.text,
    fontVariant: ['tabular-nums'],
  },
  aheadLabel: { ...theme.font.caption, color: theme.color.textMuted, flex: 1 },

  nextStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.space[2],
    backgroundColor: theme.color.teal[50],
    borderRadius: theme.radius.md,
    padding: theme.space[3],
  },
  nextStepText: { ...theme.font.body, color: theme.color.teal[900], flex: 1 },

  qrWrap: { alignItems: 'center', gap: theme.space[3] },
  qr: {
    padding: theme.space[3],
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  qrHint: { ...theme.font.caption, color: theme.color.textMuted, textAlign: 'center' },

  pending: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.space[2],
    backgroundColor: theme.color.warning.bg,
    borderRadius: theme.radius.md,
    padding: theme.space[3],
  },
  pendingText: { ...theme.font.body, color: theme.color.warning.fg, flex: 1 },
});
