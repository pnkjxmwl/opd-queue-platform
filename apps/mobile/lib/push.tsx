import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useAuth } from './auth';

/**
 * P8-MOB-01 · push notifications on the patient's phone.
 *
 * Three jobs, and they are deliberately all that this does:
 *   1. ask for permission, once, and take no for an answer
 *   2. register the device's Expo token with the API
 *   3. open the right screen when a notification is tapped
 *
 * **It reads nothing from the payload except where to navigate.** The push says
 * "something changed, here is which booking"; the token screen then fetches the truth
 * over REST like every other screen. A notification that carried status would be a
 * third source of it, arriving out of order, on a device that may have been asleep
 * for an hour (docs/Rules.md 8).
 *
 * **Declining is a supported outcome, not an error.** A patient who says no to
 * notifications still has a live queue on screen and a working app; the socket and
 * the poll do not care. Nothing here blocks, retries or nags.
 */

/**
 * Foreground behaviour. A patient staring at the token screen when "you are being
 * called" arrives should SEE it - the screen they are on updates silently over the
 * socket, and without this the one message that means "stand up and walk" would be
 * the one they miss.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** The project id EAS assigns; required for a token on a real build. */
const projectId =
  Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;

export function usePushRegistration(): void {
  const { signedIn, authedFetch } = useAuth();
  const router = useRouter();
  // Register once per signed-in session, not on every render of every screen.
  const registered = useRef(false);

  useEffect(() => {
    if (!signedIn || registered.current) return;
    registered.current = true;

    void (async () => {
      try {
        // A simulator has no push service and never will. Asking would prompt a
        // developer for permission that cannot produce a token.
        if (!Device.isDevice) return;

        if (Platform.OS === 'android') {
          // Android needs a channel before anything is delivered at all, and the
          // default one is silent. A queue call is worth a sound.
          await Notifications.setNotificationChannelAsync('queue', {
            name: 'Queue updates',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
          });
        }

        // `status` rather than the `granted` convenience flag: the flag comes from
        // expo-modules-core's PermissionResponse and is not visible through every
        // version of these types, while the three-way status has been stable
        // throughout and says the same thing.
        const existing = await Notifications.getPermissionsAsync();
        const status =
          existing.status === 'granted'
            ? existing.status
            : (await Notifications.requestPermissionsAsync()).status;

        // Declined. That is their choice and the app carries on without it.
        if (status !== 'granted') return;

        const { data: token } = await Notifications.getExpoPushTokenAsync(
          projectId === undefined ? {} : { projectId },
        );

        await authedFetch('/me/push-tokens', {
          method: 'POST',
          body: JSON.stringify({ token, platform: Platform.OS === 'ios' ? 'ios' : 'android' }),
        });
      } catch {
        // Never surface this. A failed push registration is invisible to the patient
        // and must stay that way - the queue works regardless, and an error toast
        // about notifications on the booking screen would be noise about nothing
        // they can fix.
      }
    })();
  }, [signedIn, authedFetch]);

  // Tapping a notification opens the booking it is about.
  useEffect(() => {
    const open = (response: Notifications.NotificationResponse): void => {
      const data = response.notification.request.content.data as { entryId?: string } | undefined;
      if (typeof data?.entryId === 'string') router.push(`/visit/${data.entryId}`);
    };

    // Two paths, and both are needed: the app was already running, or it was cold
    // and the tap is what started it. Missing the second means a patient who taps
    // "you are being called" from a locked phone lands on the home screen.
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync().then((last) => {
      if (last !== null) open(last);
    });

    return () => subscription.remove();
  }, [router]);
}
