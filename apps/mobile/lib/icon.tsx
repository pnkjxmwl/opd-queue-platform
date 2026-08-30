import Feather from '@expo/vector-icons/Feather';
import { theme } from '../theme';

/**
 * The app's only icon import.
 *
 * docs/Design.md 6 asks for line icons at ~1.75px stroke with rounded caps, and
 * names Lucide. Lucide is a fork of Feather and Feather ships inside
 * @expo/vector-icons, which comes with Expo - so this is the specified set with no
 * new dependency and no react-native-svg.
 *
 * Every screen imports Icon, never Feather, so the set can be swapped in one file.
 * Size defaults to 20 (docs/Design.md 6: "20 default, 24 for primary actions").
 */
export type IconName = React.ComponentProps<typeof Feather>['name'];

export function Icon({
  name,
  size = 20,
  color = theme.color.text,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  // Icons are decoration next to a label everywhere in this app (docs/Design.md 8
  // requires the label, always), so they are hidden from screen readers rather than
  // announcing a name the user did not ask for.
  return <Feather name={name} size={size} color={color} accessibilityElementsHidden />;
}
