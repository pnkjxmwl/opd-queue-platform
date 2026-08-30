import { Tabs } from 'expo-router';
import { Icon } from '../../lib/icon';
import { theme } from '../../theme';

/**
 * The signed-in shell: a bottom tab bar (docs/Design.md 5.9).
 *
 * Each tab owns its own Stack, so the tab bar stays visible while a detail screen
 * is pushed. That is the whole point: without it, a patient five screens deep into
 * city -> hospital -> department -> session has no way back to the top but to press
 * back five times, which is exactly the complaint this replaced.
 *
 * "My Visits" is the third tab in docs/Design.md 5.9 and arrives with Phase 5, when
 * there are tokens to list. A tab that leads nowhere is the /queue mistake again.
 */
export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.color.primary,
        tabBarInactiveTintColor: theme.color.textDisabled,
        tabBarStyle: {
          backgroundColor: theme.color.surface,
          borderTopColor: theme.color.border,
        },
        tabBarLabelStyle: theme.font.caption,
      }}
    >
      <Tabs.Screen
        name="(discover)"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color }) => <Icon name="compass" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <Icon name="user" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}
