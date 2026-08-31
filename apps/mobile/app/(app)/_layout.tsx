import { Tabs, router } from 'expo-router';
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
 * "My Visits" arrived with Phase 5, when there were finally tokens to list. It was
 * deliberately absent until then: a tab that leads nowhere is the /queue mistake.
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
        name="(visits)"
        options={{
          title: 'My Visits',
          tabBarIcon: ({ color }) => <Icon name="clipboard" size={22} color={color} />,
        }}
        /*
          Always open on the list.

          Booking pushes `join` onto THIS tab's stack and then replaces it with the
          token, so after paying the tab was left parked on a single token card -
          tapping My Visits showed that one token instead of the list, and with two
          bookings there was no way to the second without pressing back. A tab called
          "My Visits" has to show the visits.

          `navigate` pops back to the list if it is already in the stack rather than
          stacking another copy.
        */
        listeners={{
          // Deliberately NOT preventDefault: the default tab switch still runs, and
          // this only pops back to the list on top of it. If the navigate ever stops
          // working the tab still opens - on the wrong screen, which is today's bug -
          // rather than becoming a tab that does nothing at all.
          tabPress: () => router.navigate('/visits'),
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
