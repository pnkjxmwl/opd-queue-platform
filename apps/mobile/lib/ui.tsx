import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from '../theme';

export function Field(props: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'words';
  keyboardType?: 'default' | 'email-address';
  autoComplete?: 'email' | 'password' | 'new-password' | 'name';
}) {
  const { label, ...input } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...input}
        style={styles.input}
        placeholderTextColor={theme.color.textDisabled}
        autoCorrect={false}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  pending,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  pending?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const bg =
    variant === 'primary'
      ? theme.color.primary
      : variant === 'danger'
        ? theme.color.danger.fg
        : theme.color.surface;
  const fg = variant === 'secondary' ? theme.color.text : '#FFFFFF';

  return (
    <Pressable
      onPress={onPress}
      disabled={pending}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: pending ? theme.color.border : bg, opacity: pressed ? 0.85 : 1 },
        variant === 'secondary' && styles.buttonOutline,
      ]}
    >
      {pending ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: theme.space[2] },
  label: { ...theme.font.label, color: theme.color.text },
  input: {
    height: 48,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
    paddingHorizontal: theme.space[3],
    ...theme.font.body,
    color: theme.color.text,
  },
  button: {
    // 48 >= the 44x44 minimum touch target in docs/Design.md 8.
    height: 48,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonOutline: { borderWidth: 1, borderColor: theme.color.border },
  buttonText: { ...theme.font.label },
  error: {
    backgroundColor: theme.color.danger.bg,
    borderRadius: theme.radius.md,
    padding: theme.space[3],
  },
  errorText: { ...theme.font.body, color: theme.color.danger.fg },
});
