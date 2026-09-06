import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from './icon';
import { theme } from '../theme';

/**
 * Press feedback that matches the platform.
 *
 * Android users expect a ripple; iOS users expect a subtle opacity fade. Using one
 * model on both is a large part of why a React Native app reads as "not quite
 * native" - so every pressable in this app goes through here.
 */
export const pressable = (
  // Annotated `number`: `theme` is `as const`, so an inferred default would narrow
  // this to a literal and reject every other radius in the scale.
  //
  // The default is `control`, the radius every Button and Field actually draws.
  // It used to be `md`, so on Android the ripple was masked to a 10pt corner inside
  // a 12pt button - visible as a sliver of un-rippled fill at each corner on every
  // press in the app.
  radius: number = theme.radius.control,
): Pick<PressableProps, 'android_ripple' | 'style'> => ({
  android_ripple: { color: theme.color.slate[200], borderless: false, foreground: true },
  style: ({ pressed }) =>
    ({ opacity: Platform.OS === 'ios' && pressed ? 0.7 : 1, borderRadius: radius }) as ViewStyle,
});

/** Screen background + safe area. Every screen sits inside one of these. */
export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: insets.top }, style]}>{children}</View>
  );
}

/**
 * Initials on teal-100 (docs/Design.md 10) - the stand-in for a photo we do not
 * have for doctors, hospitals or family members.
 */
function initialsOf(name: string): string {
  return name
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = initialsOf(name);

  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: theme.radius.full },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.36 }]}>{initials || '?'}</Text>
    </View>
  );
}

export function Field(props: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'words';
  keyboardType?: 'default' | 'email-address';
  autoComplete?: 'email' | 'password' | 'new-password' | 'name';
  icon?: IconName;
  helper?: string;
}) {
  const { label, icon, helper, ...input } = props;
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {/* docs/Design.md 5.4: focus ring is teal, 2px - not the OS default outline. */}
      <View style={[styles.inputShell, focused && styles.inputShellFocused]}>
        {icon ? <Icon name={icon} size={18} color={theme.color.textDisabled} /> : null}
        <TextInput
          {...input}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={styles.input}
          placeholderTextColor={theme.color.textDisabled}
          autoCorrect={false}
        />
      </View>
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}

export function Button({
  title,
  onPress,
  pending,
  disabled,
  variant = 'primary',
  icon,
}: {
  title: string;
  onPress: () => void;
  /** Busy: shows a spinner and blocks taps. */
  pending?: boolean;
  /**
   * Not ready: blocks taps and LOOKS blocked, with no spinner.
   *
   * Distinct from `pending` because they mean different things to the person
   * looking at it - "wait" versus "you still have to do something". Without this,
   * a screen's only options were a button that lies about being busy or one that
   * looks live and silently does nothing when tapped.
   */
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
}) {
  const inert = pending === true || disabled === true;
  const fill =
    variant === 'primary'
      ? theme.color.primary
      : variant === 'danger'
        ? theme.color.danger.fg
        : variant === 'ghost'
          ? 'transparent'
          : theme.color.surface;

  const fg =
    variant === 'secondary'
      ? theme.color.text
      : variant === 'ghost'
        ? theme.color.primary
        : '#FFFFFF';

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityState={{ disabled: inert }}
      {...pressable()}
    >
      <View
        style={[
          styles.button,
          // docs/Design.md 5.1: disabled is a slate fill, not a faded primary.
          { backgroundColor: inert ? theme.color.border : fill },
          variant === 'secondary' && styles.buttonOutline,
        ]}
      >
        {pending === true ? (
          <ActivityIndicator color={theme.color.textMuted} />
        ) : (
          <>
            {icon ? <Icon name={icon} size={18} color={disabled === true ? theme.color.textMuted : fg} /> : null}
            <Text
              style={[styles.buttonText, { color: disabled === true ? theme.color.textMuted : fg }]}
            >
              {title}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Icon name="alert-circle" size={18} color={theme.color.danger.fg} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

/**
 * A section heading - "Nearby Hospitals", "Queue Progress", "Payment Methods".
 *
 * **Bold sentence case, not the uppercase tracked overline this used to render.**
 * Every reference screen in docs/ui-screens states its sections this way, and it is
 * the better call for the audience: UPPERCASE costs legibility for the older patients
 * this app is largely for, and tracked 11px grey caps read as fine print rather than
 * as the start of something.
 *
 * The `children: string` signature is unchanged, so every call site still works and
 * none of them had to learn anything.
 */
export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.section}>{children}</Text>;
}

/**
 * A photograph from the API, with the initials fallback built in.
 *
 * **The fallback lives here, not at each call site.** `photoUrl` is nullable by
 * design - most clinics at pilot will never upload one - and a remote image can also
 * simply fail on a hospital's wifi. Both are ordinary states, so every screen gets
 * the same graceful answer without having to remember.
 *
 * **React Native's `Image`, deliberately, not `expo-image`.** expo-image is the
 * better library and it is a NATIVE module - it ships `android/` and `ios/` source
 * and an `expo-module.config.json`. A dev client built before it was installed does
 * not contain that native code, so requiring it throws at runtime and the only fix
 * is a fresh APK. On a free tier with a build budget that is a real cost to pay for
 * a fade. RN's own Image is already in every build, and Android backs it with
 * Fresco's disk cache, so the scroll-re-download problem is handled anyway.
 *
 * The initials sit UNDERNEATH the image rather than instead of it, and the photo
 * fades in over them. That means there is never a grey box or an empty hole: the
 * loading state, the null state and the error state are all the same thing, and it
 * is a thing that looks deliberate.
 */
export function Photo({
  uri,
  name,
  style,
  radius = theme.radius.md,
  initialsSize = 16,
}: {
  uri: string | null;
  /** Used for the initials shown while loading, and kept if there is no image. */
  name: string;
  /** Sets the box. Width and height, or a flex, live here. */
  style?: StyleProp<ViewStyle>;
  radius?: number;
  initialsSize?: number;
}) {
  const [failed, setFailed] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;

  // A FlatList reuses row views, so without this a recycled row keeps the previous
  // photo's faded-in opacity - and a stale `failed` would hide a perfectly good
  // image for the next hospital that happens to land in that slot.
  useEffect(() => {
    setFailed(false);
    fade.setValue(0);
  }, [uri, fade]);

  const usable = uri !== null && uri !== '' && !failed;

  return (
    <View style={[styles.photo, { borderRadius: radius }, style]}>
      <Text style={[styles.photoInitials, { fontSize: initialsSize }]}>
        {initialsOf(name) || '?'}
      </Text>
      {usable ? (
        <Animated.Image
          source={{ uri }}
          style={[StyleSheet.absoluteFill, { opacity: fade }]}
          resizeMode="cover"
          onLoad={() =>
            Animated.timing(fade, {
              toValue: 1,
              duration: 220,
              useNativeDriver: true,
            }).start()
          }
          onError={() => setFailed(true)}
        />
      ) : null}
    </View>
  );
}

/**
 * A pulsing placeholder block.
 *
 * **This exists to kill the centred spinner**, which is the most reliable "hobby app"
 * signal a screen can send. A spinner says "something is happening somewhere"; a
 * skeleton says "a list of hospitals is arriving, and it will be shaped like this".
 *
 * It also removes the layout jump: the placeholder occupies the geometry the real
 * content will, so nothing moves under the reader's thumb when data lands.
 */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return <Animated.View style={[styles.skeleton, style, { opacity: pulse }]} />;
}

/** A placeholder shaped like the hospital and doctor rows in discovery. */
export function RowSkeleton() {
  return (
    <View style={styles.rowSkeleton}>
      <Skeleton style={styles.rowSkeletonThumb} />
      <View style={styles.rowSkeletonText}>
        <Skeleton style={{ height: 16, width: '65%', borderRadius: 6 }} />
        <Skeleton style={{ height: 13, width: '40%', borderRadius: 6 }} />
        <Skeleton style={{ height: 22, width: 104, borderRadius: theme.radius.full }} />
      </View>
    </View>
  );
}

/**
 * The standard surface. A hairline AND a soft shadow, never one alone
 * (docs/Design.md 4): the shadow vanishes against `canvas` on a cheap LCD in
 * daylight, and a border on its own reads as a wireframe.
 *
 * **It existed nine times before it existed once.** The token screen, the visits
 * list, the profile and the session detail each declared their own `card` style, and
 * they had drifted to three different paddings and two different radii. This is the
 * same object every one of them was approximating.
 */
export function Card({
  title,
  children,
  style,
}: {
  /** Optional section heading, rendered with the app's one section treatment. */
  title?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.card, style]}>
      {title !== undefined ? <SectionLabel>{title}</SectionLabel> : null}
      {children}
    </View>
  );
}

/**
 * A label and its value on one line - the shape of every detail list in the app.
 *
 * `emphasis` is what the flat version was missing: on the token screen "Fee" and
 * "Seen by" were the same size and weight, so the number a patient actually opened
 * the app for sat in a column of things they did not.
 */
export function KeyValue({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={[styles.kvValue, emphasis && styles.kvValueStrong]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

/**
 * A two-or-three-way switch between views of the same list.
 *
 * A track with a raised thumb, rather than two loose pills: the pills gave no sense
 * of being two halves of one control, so "Upcoming" and "Past" read as two buttons
 * and it was never obvious that picking one deselected the other.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segment} accessibilityRole="tablist">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.segmentItem, on && styles.segmentItemOn]}
            android_ripple={{ color: theme.color.slate[200], borderless: false }}
          >
            <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    padding: theme.space[4],
    gap: theme.space[3],
    ...theme.elevation.card,
  },

  kv: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: theme.space[4],
  },
  kvLabel: { ...theme.font.body, color: theme.color.textMuted, flexShrink: 1 },
  kvValue: {
    ...theme.font.body,
    color: theme.color.text,
    fontFamily: theme.fontFamily.medium,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
    textAlign: 'right',
  },
  kvValueStrong: {
    ...theme.font.h3,
    color: theme.color.text,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },

  segment: {
    flexDirection: 'row',
    gap: theme.space[1],
    padding: 3,
    borderRadius: theme.radius.control,
    backgroundColor: theme.color.slate[100],
  },
  segmentItem: {
    flex: 1,
    // 44 is the floor in docs/Design.md 8; the track's own padding takes it to 50.
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.md,
  },
  segmentItemOn: { backgroundColor: theme.color.surface, ...theme.elevation.sm },
  segmentText: { ...theme.font.label, color: theme.color.textMuted },
  segmentTextOn: { color: theme.color.text, fontFamily: theme.fontFamily.semibold, fontWeight: '600' },

  screen: { flex: 1, backgroundColor: theme.color.canvas },

  avatar: {
    backgroundColor: theme.color.teal[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: theme.color.teal[700],
    fontFamily: theme.fontFamily.semibold,
    fontWeight: '600',
    // Two capitals alone in a circle read as one glyph at 40px without this.
    letterSpacing: 0.4,
  },

  field: { gap: theme.space[2] },
  label: { ...theme.font.label, color: theme.color.text },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[2],
    height: 52,
    borderRadius: theme.radius.control,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
    paddingHorizontal: theme.space[4],
  },
  /**
   * **Colour only.** No width, no elevation, no background - nothing that changes
   * geometry or makes Android rebuild the view's layer.
   *
   * Both fancier versions of this broke the auth screens on a real phone. An
   * `elevation` made Android rebuild the shadow layer under a focused TextInput,
   * which drops focus, which fires `onBlur`, which removes the elevation, which
   * rebuilds again - the keyboard opened and shut and every field looked like it had
   * a caret in it. Even the original `borderWidth: 1 -> 2` is suspect, because these
   * screens centre their content in a ScrollView: the keyboard resizes the window,
   * the content re-centres, and a field that also changes height re-centres twice.
   *
   * A colour swap cannot take part in any of that.
   */
  inputShellFocused: { borderColor: theme.color.primary },
  /**
   * Deliberately NOT `...theme.font.*`.
   *
   * Every font token carries a `lineHeight`, and `lineHeight` on an Android
   * TextInput is documented as unreliable - it clips glyphs and offsets the caret
   * from the box you can see.
   *
   * `alignSelf: 'stretch'` with `paddingVertical: 0` is the tap-target fix. In a row
   * with `alignItems: 'center'` the input is only as tall as its text, so the live
   * strip was about 19px inside a box that LOOKS tappable for its full height - you
   * had to hit the middle of it. Stretching makes the whole shell work.
   */
  input: {
    flex: 1,
    alignSelf: 'stretch',
    fontSize: 16,
    fontFamily: theme.fontFamily.regular,
    color: theme.color.text,
    paddingVertical: 0,
    textAlignVertical: 'center',
  },
  helper: { ...theme.font.caption, color: theme.color.textMuted },

  button: {
    // 52, comfortably past the 44x44 minimum in docs/Design.md 8 and matching the
    // full-width primary action in every reference screen.
    height: 52,
    borderRadius: theme.radius.control,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space[2],
  },
  buttonOutline: { borderWidth: 1, borderColor: theme.color.border },
  buttonText: {
    ...theme.font.label,
    fontFamily: theme.fontFamily.semibold,
    fontWeight: '600',
    fontSize: 16,
  },

  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.space[2],
    backgroundColor: theme.color.danger.bg,
    borderRadius: theme.radius.md,
    padding: theme.space[3],
  },
  errorText: { ...theme.font.body, color: theme.color.danger.fg, flex: 1 },

  section: { ...theme.font.h3, color: theme.color.text },

  photo: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    // Tinted, never grey: a grey box reads as a hole in the screen.
    backgroundColor: theme.color.teal[50],
  },
  photoInitials: {
    color: theme.color.teal[700],
    fontFamily: theme.fontFamily.semibold,
    fontWeight: '600',
    letterSpacing: 0.4,
  },

  skeleton: { backgroundColor: theme.color.slate[200], borderRadius: theme.radius.sm },
  rowSkeleton: {
    flexDirection: 'row',
    gap: theme.space[3],
    padding: theme.space[3],
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  rowSkeletonThumb: { width: 88, height: 88, borderRadius: theme.radius.control },
  rowSkeletonText: { flex: 1, gap: theme.space[2], paddingVertical: theme.space[1] },
});
