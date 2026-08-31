import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { DoctorPresence, SessionCard, SessionStatus } from '@opd/contracts';
// Type-only: erased at compile time, so this does not create a runtime cycle with
// lib/visits.tsx, which imports Pill from here.
// TYPE ONLY, and that is load-bearing: lib/visits.tsx imports Pill from THIS
// module, so a value import here would be a genuine runtime cycle. Type imports
// are erased at compile time, so this one costs nothing. The card therefore
// receives a resolved BookingState rather than computing one - which also keeps
// it presentational, like every other prop it takes.
import type { BookingState } from './visits';
import { Avatar, Button, ErrorNote, pressable } from './ui';
import { Icon, type IconName } from './icon';
import { istRange, rupees } from './format';
import { theme } from '../theme';

/**
 * Shared discovery UI: the loading/error/empty states every screen owes the user
 * (docs/Rules.md 9), and the session card that is the product's shop window
 * (docs/Design.md 5.5).
 */

/**
 * How many rows a discovery screen asks for. The API caps a page at 100
 * (docs/Rules.md 6); Phase 3 fetches one large page and says so when it truncates,
 * rather than shipping infinite scroll for lists that hold two hospitals today.
 */
export const PAGE = 50;

type Tone = 'success' | 'info' | 'warning' | 'neutral';

/**
 * docs/Design.md 5.3 and 8: status is NEVER colour alone. Every pill carries an
 * icon AND a written label, so it still reads for a colour-blind user or in bright
 * sunlight outside a hospital.
 */
export function Pill({ label, tone, icon }: { label: string; tone: Tone; icon: IconName }) {
  const palette =
    tone === 'success'
      ? theme.color.success
      : tone === 'warning'
        ? theme.color.warning
        : tone === 'info'
          ? theme.color.info
          : { fg: theme.color.textMuted, bg: theme.color.slate[100] };

  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      <Icon name={icon} size={12} color={palette.fg} />
      <Text style={[styles.pillText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

const SESSION_LABEL: Record<SessionStatus, { label: string; tone: Tone; icon: IconName }> = {
  SCHEDULED: { label: 'Scheduled', tone: 'info', icon: 'clock' },
  OPEN_FOR_REGISTRATION: { label: 'Open', tone: 'success', icon: 'check-circle' },
  ACTIVE: { label: 'In progress', tone: 'success', icon: 'activity' },
  COMPLETED: { label: 'Finished', tone: 'neutral', icon: 'check' },
  ENDED_EARLY: { label: 'Ended early', tone: 'warning', icon: 'alert-triangle' },
  // Never listed by the API, but the map has to be total for the type to hold.
  CANCELLED: { label: 'Cancelled', tone: 'warning', icon: 'slash' },
};

/** docs/PRD.md 8.10 - presence is a separate fact from the session's status. */
const PRESENCE_LABEL: Record<DoctorPresence, { label: string; tone: Tone; icon: IconName }> = {
  NOT_PRESENT: { label: 'Doctor not arrived', tone: 'neutral', icon: 'user-x' },
  PRESENT: { label: 'Doctor in', tone: 'success', icon: 'user-check' },
  ON_BREAK: { label: 'On a break', tone: 'warning', icon: 'coffee' },
  LEFT: { label: 'Doctor has left', tone: 'warning', icon: 'log-out' },
};

export function SessionStatusPill({ status }: { status: SessionStatus }) {
  return <Pill {...SESSION_LABEL[status]} />;
}

export function PresencePill({ presence }: { presence: DoctorPresence }) {
  return <Pill {...PRESENCE_LABEL[presence]} />;
}

/**
 * Loading, error and empty in one place, because every screen owes all three and
 * writing them per screen is how one of them goes missing.
 *
 * Renders nothing once there is data - the screen draws its own list.
 */
export function QueryState({
  pending,
  error,
  isEmpty,
  emptyText,
  emptyIcon = 'inbox',
  onRetry,
}: {
  pending: boolean;
  error: Error | null;
  isEmpty?: boolean;
  emptyText?: string;
  emptyIcon?: IconName;
  onRetry?: () => void;
}) {
  if (pending) {
    return (
      <View style={styles.state}>
        <ActivityIndicator color={theme.color.primary} />
      </View>
    );
  }

  // docs/Design.md 10: empty states are friendly and teal, not a line of grey text.
  if (error) {
    return (
      <View style={styles.state}>
        <View style={styles.stateIcon}>
          <Icon name="wifi-off" size={26} color={theme.color.primary} />
        </View>
        <ErrorNote message={error.message} />
        {onRetry ? <Button title="Try again" variant="secondary" onPress={onRetry} /> : null}
      </View>
    );
  }

  if (isEmpty) {
    return (
      <View style={styles.state}>
        <View style={styles.stateIcon}>
          <Icon name={emptyIcon} size={26} color={theme.color.primary} />
        </View>
        <Text style={styles.empty}>{emptyText ?? 'Nothing here yet.'}</Text>
      </View>
    );
  }

  return null;
}

/**
 * Honest note when a page was truncated. Phase 3 fetches one large page rather
 * than paging - the API paginates (docs/Rules.md 6), so saying so beats silently
 * hiding rows.
 *
 * ponytail: swap for useInfiniteQuery the first time a real city has more than a
 * page of hospitals.
 */
export function MoreNote({ shown, total }: { shown: number; total: number }) {
  if (shown >= total) return null;
  return (
    <Text style={styles.more}>
      Showing {shown} of {total}. Narrow your search to see more.
    </Text>
  );
}

/** A tappable row - the hospital / department / doctor list unit. */
export function Row({
  title,
  subtitle,
  meta,
  icon,
  avatar,
  badge,
  onPress,
}: {
  title: string;
  subtitle?: string;
  meta?: string;
  icon?: IconName;
  /** Name to derive initials from. Takes precedence over `icon`. */
  avatar?: string;
  badge?: { label: string; tone: Tone; icon: IconName };
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" {...pressable(theme.radius.lg)}>
      <View style={styles.row}>
        {avatar ? (
          <Avatar name={avatar} />
        ) : icon ? (
          <View style={styles.rowIcon}>
            <Icon name={icon} size={20} color={theme.color.primary} />
          </View>
        ) : null}

        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.rowSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
          {badge ? (
            <View style={styles.rowBadge}>
              <Pill {...badge} />
            </View>
          ) : null}
        </View>

        {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
        <Icon name="chevron-right" size={20} color={theme.color.slate[300]} />
      </View>
    </Pressable>
  );
}

/**
 * The session card (docs/Design.md 5.5) - doctor headline, status, the live queue
 * numbers and the fee.
 *
 * The Join button is deliberately present and disabled with a written reason.
 * docs/Phases.md predicts that an inert placeholder with no explanation gets filed
 * as a bug against itself.
 */
export function SessionCardView({
  card,
  onPress,
  onJoin,
  onOpenToken,
  booking = { kind: 'none' },
}: {
  card: SessionCard;
  onPress: () => void;
  /**
   * Book straight from the card. Optional only so a caller can render a read-only
   * list; every real list passes it.
   *
   * Before Phase 5 this card carried a Join button that was disabled ALWAYS, because
   * joining did not exist. Once it did, that button stayed grey on a session the
   * server was happily accepting bookings for - so the control read as broken rather
   * than as unavailable. A disabled button must mean "not now", never "not built".
   */
  onJoin?: () => void;
  /** Open the token this account already holds here. Needed only when `myEntries` is non-empty. */
  onOpenToken?: (entryId: string) => void;
  /**
   * What this account holds in THIS session, resolved by the list screen with
   * `bookingStateFor(useMyActiveEntries().bySession.get(id))`.
   *
   * Passed in rather than derived here so the card stays presentational and the list
   * fetches once instead of once per card.
   */
  booking?: BookingState;
}) {
  const { snapshot } = card;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" {...pressable(theme.radius.lg)}>
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Avatar name={card.doctorName} size={44} />
          <View style={styles.cardHeadText}>
            <Text style={styles.doctor} numberOfLines={1}>
              {card.doctorName}
            </Text>
            <Text style={styles.caption} numberOfLines={1}>
              {card.departmentName} · {istRange(card.scheduledStart, card.scheduledEnd)}
            </Text>
          </View>
          <SessionStatusPill status={card.status} />
        </View>

        {card.isSubstitute ? (
          <Text style={styles.caption}>Covering for the booked doctor</Text>
        ) : null}

        <View style={styles.rule} />

        <View style={styles.stats}>
          <Stat label="Now serving" value={snapshot.nowServingToken ?? '—'} />
          <Stat label="Checked in" value={String(snapshot.checkedInCount)} />
          <Stat label="Booked" value={String(snapshot.bookedNotArrivedCount)} />
        </View>

        {/* Phase 7 fills the window; until then say so rather than showing a fake one. */}
        <View style={styles.etaRow}>
          <Icon
            name={snapshot.joinNowEtaFrom ? 'clock' : 'info'}
            size={14}
            color={theme.color.primary}
          />
          <Text style={styles.eta}>
            {snapshot.joinNowEtaFrom && snapshot.joinNowEtaTo
              ? `Join now → seen ~${istRange(snapshot.joinNowEtaFrom, snapshot.joinNowEtaTo)}`
              : 'Live wait times arrive with the queue engine.'}
          </Text>
        </View>

        <View style={styles.cardFoot}>
          <Text style={styles.fee}>{rupees(card.feePaise)}</Text>
          <JoinButton
            registrationOpen={snapshot.registrationOpen}
            onJoin={onJoin}
            onOpenToken={
              booking.kind === 'none' ? undefined : () => onOpenToken?.(booking.entry.id)
            }
            booking={booking}
          />
        </View>
      </View>
    </Pressable>
  );
}

/**
 * `registrationOpen` is the SERVER's answer (docs/PRD.md 8.12) - the client never
 * works it out for itself, and as of Phase 5 that answer includes the hospital's
 * token cap and clock cutoff, not just the session's own status.
 *
 * Advisory, though: the button being live does not mean the join will succeed. The
 * last slot can go while this screen is open, so the join screen surfaces the
 * server's rejection rather than assuming this was still true (docs/Rules.md 1).
 *
 * **`booking` changes what this control IS.** Once the account holds a place here,
 * offering a bare "Join" is a lie the server then rejects with ALREADY_IN_QUEUE - so
 * the button becomes the way back to that token, or the way to finish paying for it.
 * Booking a DIFFERENT patient into the same session stays possible and is offered on
 * the session detail screen, which has room to say so; the server allows it because
 * its check is scoped to (session, patient) rather than to the account.
 *
 * Without `onJoin` it is a disabled control, which is only correct where there is
 * genuinely nothing to tap. A nested Pressable captures its own touch, so this works
 * inside the session card without also triggering the card's own navigation.
 */
export function JoinButton({
  registrationOpen,
  onJoin,
  onOpenToken,
  booking = { kind: 'none' },
}: {
  registrationOpen: boolean;
  onJoin?: () => void;
  /** Where the patient's existing token lives. Required once `booking` is not 'none'. */
  onOpenToken?: () => void;
  booking?: BookingState;
}) {
  if (booking.kind !== 'none') {
    const reserved = booking.kind === 'reserved';
    return (
      <View style={styles.join}>
        <Pressable
          onPress={reserved ? onJoin : onOpenToken}
          accessibilityRole="button"
          accessibilityLabel={
            reserved
              ? 'Finish paying for your held place'
              : `View your token ${booking.entry.tokenLabel}`
          }
          {...pressable(theme.radius.md)}
        >
          <View style={[styles.joinButton, reserved ? styles.joinHold : styles.joinBooked]}>
            <Icon
              name={reserved ? 'clock' : 'check-circle'}
              size={16}
              color={reserved ? theme.color.warning.fg : theme.color.teal[800]}
            />
            <Text
              style={[styles.joinText, reserved ? styles.joinHoldText : styles.joinBookedText]}
              numberOfLines={1}
            >
              {reserved
                ? 'Finish payment'
                : booking.kind === 'booked' && booking.count > 1
                  ? `Booked · ${booking.count} tokens`
                  : `Booked · ${booking.entry.tokenLabel}`}
            </Text>
          </View>
        </Pressable>
      </View>
    );
  }

  const live = registrationOpen && onJoin !== undefined;

  return (
    <View style={styles.join}>
      {/*
        Feedback on the Pressable, visuals on an inner View - the same shape as
        SessionCardView above, and not a stylistic preference.

        `pressable()` returns a `style` prop of its own. Spreading it onto a
        Pressable that ALSO has `style` means the later one wins and the earlier is
        silently discarded - which is exactly what happened here: the live button
        lost its height, width and fill and rendered as an invisible sliver, while
        every disabled button (spreading nothing) looked fine. The button
        disappeared precisely when it became tappable.
      */}
      <Pressable
        onPress={live ? onJoin : undefined}
        disabled={!live}
        accessibilityRole="button"
        accessibilityState={{ disabled: !live }}
        accessibilityLabel={
          registrationOpen ? 'Join this session' : 'Registration closed for this session'
        }
        {...(live ? pressable(theme.radius.md) : {})}
      >
        <View style={[styles.joinButton, live && styles.joinButtonLive]}>
          <Icon
            name={registrationOpen ? 'log-in' : 'lock'}
            size={16}
            color={live ? '#FFFFFF' : theme.color.textDisabled}
          />
          <Text style={[styles.joinText, live && styles.joinTextLive]}>
            {registrationOpen ? 'Join' : 'Closed'}
          </Text>
        </View>
      </Pressable>
      {!registrationOpen && <Text style={styles.joinReason}>Registration closed</Text>}
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
  state: { paddingVertical: theme.space[8], alignItems: 'center', gap: theme.space[3] },
  stateIcon: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.teal[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    ...theme.font.body,
    color: theme.color.textMuted,
    textAlign: 'center',
    paddingHorizontal: theme.space[6],
  },
  more: {
    ...theme.font.caption,
    color: theme.color.textMuted,
    textAlign: 'center',
    paddingVertical: theme.space[3],
  },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[1],
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.space[2],
    paddingVertical: 3,
  },
  pillText: { ...theme.font.caption },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[3],
    // 64 clears the 44x44 minimum target in docs/Design.md 8 with room for two lines.
    minHeight: 64,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.space[4],
    paddingVertical: theme.space[3],
    ...theme.elevation.sm,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.teal[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...theme.font.h3, color: theme.color.text },
  rowSubtitle: { ...theme.font.body, color: theme.color.textMuted },
  rowBadge: { flexDirection: 'row', marginTop: theme.space[1] },
  rowMeta: { ...theme.font.caption, color: theme.color.textMuted, fontVariant: ['tabular-nums'] },

  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.space[4],
    gap: theme.space[3],
    ...theme.elevation.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: theme.space[3] },
  cardHeadText: { flex: 1, gap: 2 },
  doctor: { ...theme.font.h3, color: theme.color.text },
  caption: { ...theme.font.caption, color: theme.color.textMuted },
  rule: { height: 1, backgroundColor: theme.color.border },

  stats: { flexDirection: 'row', gap: theme.space[8] },
  stat: { gap: 2 },
  statLabel: { ...theme.font.overline, color: theme.color.textMuted },
  // Tabular figures so a number changing live does not shift the layout (Design 3).
  statValue: { ...theme.font.h3, color: theme.color.text, fontVariant: ['tabular-nums'] },

  etaRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space[2] },
  eta: { ...theme.font.body, color: theme.color.primary, flex: 1 },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fee: { ...theme.font.h2, color: theme.color.text, fontVariant: ['tabular-nums'] },

  join: { alignItems: 'flex-end', gap: 2 },
  joinButtonLive: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  joinButton: {
    height: 44,
    minWidth: 104,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space[2],
    borderRadius: theme.radius.md,
    // docs/Design.md 5.1: disabled is slate fill + slate text, not a faded primary.
    backgroundColor: theme.color.slate[100],
  },
  joinText: { ...theme.font.label, color: theme.color.textDisabled },
  // docs/Design.md 5.1: the live form is the teal primary, the disabled form
  // stays a slate fill - never a faded primary.
  joinTextLive: { color: '#FFFFFF' },
  // Booked is a STATUS that happens to be tappable, not a call to action, so it is a
  // tinted surface rather than the solid teal primary. An unpaid hold borrows the
  // warning tone because it is the one that needs doing something about.
  joinBooked: { backgroundColor: theme.color.teal[100] },
  joinBookedText: { color: theme.color.teal[800] },
  joinHold: { backgroundColor: theme.color.warning.bg },
  joinHoldText: { color: theme.color.warning.fg },
  joinReason: { ...theme.font.caption, color: theme.color.textMuted },
});
