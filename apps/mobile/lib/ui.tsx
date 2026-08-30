import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
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
  // this to the literal 10 and reject every other radius in the scale.
  radius: number = theme.radius.md,
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
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

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
  variant = 'primary',
  icon,
}: {
  title: string;
  onPress: () => void;
  pending?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
}) {
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
      disabled={pending}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!pending }}
      {...pressable()}
    >
      <View
        style={[
          styles.button,
          // docs/Design.md 5.1: disabled is a slate fill, not a faded primary.
          { backgroundColor: pending ? theme.color.border : fill },
          variant === 'secondary' && styles.buttonOutline,
        ]}
      >
        {pending ? (
          <ActivityIndicator color={theme.color.textMuted} />
        ) : (
          <>
            {icon ? <Icon name={icon} size={18} color={fg} /> : null}
            <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
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

/** UPPERCASE section header (docs/Design.md 3, overline). */
export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.section}>{children.toUpperCase()}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.canvas },

  avatar: {
    backgroundColor: theme.color.teal[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: theme.color.teal[700], fontWeight: '600' },

  field: { gap: theme.space[2] },
  label: { ...theme.font.label, color: theme.color.text },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[2],
    height: 48,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
    paddingHorizontal: theme.space[3],
  },
  inputShellFocused: { borderColor: theme.color.accent, borderWidth: 2 },
  input: { flex: 1, ...theme.font.body, color: theme.color.text },
  helper: { ...theme.font.caption, color: theme.color.textMuted },

  button: {
    // 48 clears the 44x44 minimum touch target in docs/Design.md 8.
    height: 48,
    borderRadius: theme.radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space[2],
  },
  buttonOutline: { borderWidth: 1, borderColor: theme.color.border },
  buttonText: { ...theme.font.label },

  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.space[2],
    backgroundColor: theme.color.danger.bg,
    borderRadius: theme.radius.md,
    padding: theme.space[3],
  },
  errorText: { ...theme.font.body, color: theme.color.danger.fg, flex: 1 },

  section: { ...theme.font.overline, color: theme.color.textMuted },
});
