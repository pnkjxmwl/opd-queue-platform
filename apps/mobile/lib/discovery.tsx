import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { DoctorPresence, SessionCard, SessionStatus } from '@opd/contracts';
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
export function SessionCardView({ card, onPress }: { card: SessionCard; onPress: () => void }) {
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
          <JoinButton registrationOpen={snapshot.registrationOpen} />
        </View>
      </View>
    </Pressable>
  );
}

/**
 * Visible, disabled, and honest about why. `registrationOpen` is the server's
 * answer (docs/PRD.md 8.12) - the client never works it out for itself.
 */
export function JoinButton({ registrationOpen }: { registrationOpen: boolean }) {
  return (
    <View style={styles.join}>
      <View
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        accessibilityLabel={
          registrationOpen ? 'Join, not available yet' : 'Registration closed for this session'
        }
        style={styles.joinButton}
      >
        <Icon
          name={registrationOpen ? 'log-in' : 'lock'}
          size={16}
          color={theme.color.textDisabled}
        />
        <Text style={styles.joinText}>{registrationOpen ? 'Join' : 'Closed'}</Text>
      </View>
      <Text style={styles.joinReason}>
        {registrationOpen ? 'Booking opens soon' : 'Registration closed'}
      </Text>
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
  joinReason: { ...theme.font.caption, color: theme.color.textMuted },
});
