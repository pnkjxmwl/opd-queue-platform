import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { JoinResponse, MyQueueEntry, Paginated, Patient, SessionDetail } from '@opd/contracts';
import { useApi, useApiPost } from '../../../lib/api';
import { QueryState } from '../../../lib/discovery';
import { Button, ErrorNote, SectionLabel } from '../../../lib/ui';
import { Icon } from '../../../lib/icon';
import { MY_ACTIVE_ENTRIES, useMyActiveEntries } from '../../../lib/visits';
import { calendarDate, istRange, rupees } from '../../../lib/format';
import { theme } from '../../../theme';

/**
 * P5-MOB-01 · confirm who is visiting, pay, and wait for the server's token.
 *
 * **The client never creates the token, and never decides that a payment happened.**
 * Only the signature-verified webhook issues a token (docs/Rules.md 1.4), so this
 * screen's job is to open Checkout and then keep asking the SERVER whether the token
 * exists yet.
 *
 * That is also why polling starts when checkout OPENS rather than when Checkout says
 * "paid". A card payment finishes inside the page and calls `handler`; **netbanking
 * and UPI-intent do not** - they navigate away to a bank, or hand off to another app,
 * and the callback that would have told us goes with the page that owned it. Waiting
 * for a message that never arrives is what made netbanking look like a failure when
 * the money had actually moved. Asking the server works for every method, including
 * ones Razorpay adds later.
 */

/** How often to ask the server whether the webhook has landed yet. */
const CONFIRM_POLL_MS = 2_000;
/**
 * How long to keep asking before sending them to My Visits.
 *
 * Giving up is not failure: if the payment succeeded the webhook will land, so the
 * honest message is "still confirming", never "payment failed".
 */
const CONFIRM_TIMEOUT_MS = 90_000;

/** Our own page's origin. Anything else means Checkout has gone off to a bank. */
const CHECKOUT_ORIGIN = 'https://opd-queue.local';
/**
 * Where Razorpay sends the browser back to when the payment finishes.
 *
 * **Comes from the server** (`JoinResponse.callbackUrl`), not built here: it has to
 * be a real, publicly reachable address for the gateway to accept it, and only the
 * server knows what that is. Hardcoding it on both sides is how the two silently
 * drift apart - the first attempt did exactly that and pointed at a path that does
 * not exist.
 *
 * The app intercepts it rather than loading it, and still reads the OUTCOME from the
 * server. Nothing in this URL is trusted: it says "the gateway is done", never "the
 * payment succeeded".
 */

type Phase =
  | { name: 'choosing' }
  | { name: 'checkout'; order: JoinResponse }
  | { name: 'confirming'; entryId: string };

export default function Join() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();

  const session = useApi<SessionDetail>(`/sessions/${sessionId}`);
  // A bare array, not a page: GET /patients is the ONE documented unpaginated
  // endpoint (docs/PROGRESS.md).
  const patients = useApi<Patient[]>('/patients');
  const join = useApiPost<{ patientId: string }, JoinResponse>(`/sessions/${sessionId}/join`);
  // Same cache entry as the `active` query further down - one request, two readers.
  const myBookings = useMyActiveEntries();

  const [patientId, setPatientId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'choosing' });
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Whether Checkout ever left our page. If it did, a bank or a payment app was
   * involved and money may well have moved - so closing the sheet must wait for the
   * server rather than assume the patient changed their mind.
   */
  const leftOurPage = useRef(false);

  /**
   * Who on this account already holds a place in THIS session.
   *
   * The server allows a second patient here - its check is scoped to
   * (session, patient) - but it refuses the SAME patient twice with
   * ALREADY_IN_QUEUE. Marking them unselectable makes that 409 unreachable rather
   * than merely handled, which is the difference between a picker that teaches the
   * rule and one that punishes you for not knowing it.
   */
  const bookedPatientIds = useMemo(
    () =>
      new Set(
        (myBookings.bySession.get(sessionId) ?? [])
          // A RESERVED hold is not a booking: re-picking that patient RESUMES their
          // unpaid checkout, which is exactly what they want.
          .filter((entry) => entry.status !== 'RESERVED')
          .map((entry) => entry.patientId),
      ),
    [myBookings.bySession, sessionId],
  );

  const people = useMemo(() => patients.data ?? [], [patients.data]);
  const selectable = useMemo(
    () => people.filter((person) => !bookedPatientIds.has(person.id)),
    [people, bookedPatientIds],
  );

  /**
   * Preselect the first bookable profile.
   *
   * It used to fire only when there was EXACTLY one, which left `patientId` null for
   * an account with two - and `startPayment` begins `if (patientId === null) return`,
   * so the Pay button looked live and silently did nothing. Booking for yourself is
   * the overwhelmingly common case, the choice is one tap to change, and the picker
   * shows plainly who is selected.
   *
   * Counting only SELECTABLE profiles matters: preselecting someone already booked
   * would dead-end the screen on a patient the server is going to refuse.
   */
  useEffect(() => {
    if (patientId === null && selectable.length > 0) setPatientId(selectable[0]!.id);
  }, [selectable, patientId]);

  // ---------------------------------------------------------------------------
  // Watching the server, from the moment checkout opens
  // ---------------------------------------------------------------------------

  const watching = phase.name === 'checkout' || phase.name === 'confirming';
  const entryId =
    phase.name === 'checkout' ? phase.order.entry.id : phase.name === 'confirming' ? phase.entryId : null;

  const active = useApi<Paginated<MyQueueEntry>>(
    MY_ACTIVE_ENTRIES,
    watching,
    watching ? CONFIRM_POLL_MS : undefined,
  );

  useEffect(() => {
    if (!watching || entryId === null) return;
    const entry = active.data?.items.find((e) => e.id === entryId);
    // RESERVED means the hold exists but nothing is paid for yet. Anything else and
    // the server has decided - the only opinion that counts.
    if (entry !== undefined && entry.status !== 'RESERVED') {
      router.replace(`/visit/${entry.id}`);
    }
  }, [watching, entryId, active.data, router]);

  useEffect(() => {
    if (phase.name !== 'confirming') return;
    const timer = setTimeout(() => {
      setNotice(
        'We are still confirming your payment. If it went through, your token will appear in My Visits shortly.',
      );
      setPhase({ name: 'choosing' });
    }, CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase.name]);

  // ---------------------------------------------------------------------------

  const startPayment = () => {
    if (patientId === null) return;
    setNotice(null);
    leftOurPage.current = false;
    join.mutate(
      { patientId },
      {
        onSuccess: (order) => {
          // Already paid for - the server refuses a second booking, so this is the
          // resume path after a crash rather than a new order.
          if (order.entry.status !== 'RESERVED') {
            router.replace(`/visit/${order.entry.id}`);
            return;
          }
          setPhase({ name: 'checkout', order });
        },
      },
    );
  };

  /** Close the sheet. Keeps waiting on the server if a bank was ever involved. */
  const closeCheckout = useCallback((reason?: string) => {
    setPhase((current) => {
      if (current.name !== 'checkout') return current;
      if (leftOurPage.current) {
        // They reached a bank or a payment app. Do NOT call this a cancellation -
        // ask the server, which is the only thing that knows.
        return { name: 'confirming', entryId: current.order.entry.id };
      }
      if (reason !== undefined) setNotice(reason);
      return { name: 'choosing' };
    });
  }, []);

  const onCheckoutMessage = useCallback(
    (raw: string) => {
      const message = safeParse(raw);
      if (phase.name !== 'checkout') return;

      if (message?.type === 'success') {
        // Deliberately not treated as "booked" - it only means Checkout believes it
        // is done. The server decides, and we are already asking it.
        setPhase({ name: 'confirming', entryId: phase.order.entry.id });
        return;
      }

      closeCheckout(
        message?.type === 'failed'
          ? `Payment failed: ${message.description ?? 'the bank declined it'}. Your place is still held - you can try again.`
          : 'Payment was not completed. Your place is held for a few more minutes if you want to try again.',
      );
    },
    [phase, closeCheckout],
  );

  const detail = session.data;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Confirm booking' }} />

      <ScrollView contentContainerStyle={styles.content}>
        <QueryState
          pending={session.isPending || patients.isPending}
          error={session.error ?? patients.error}
          onRetry={() => void session.refetch()}
        />

        {detail !== undefined && (
          <>
            <View style={styles.card}>
              <SectionLabel>Appointment</SectionLabel>
              <Text style={styles.doctor}>{detail.doctorName}</Text>
              <Text style={styles.meta}>
                {detail.departmentName} · {detail.hospitalName}
              </Text>
              <Text style={styles.meta}>
                {calendarDate(detail.date)} · {istRange(detail.scheduledStart, detail.scheduledEnd)}
              </Text>
            </View>

            <View style={styles.card}>
              <SectionLabel>Who is visiting</SectionLabel>
              {people.length === 0 ? (
                <Text style={styles.meta}>
                  Add a patient profile from the Profile tab before booking.
                </Text>
              ) : selectable.length === 0 ? (
                <Text style={styles.meta}>
                  Everyone on this account already has a token for this session. Add another patient
                  profile from the Profile tab to book for someone else.
                </Text>
              ) : (
                people.map((person) => {
                  const alreadyBooked = bookedPatientIds.has(person.id);
                  const selected = patientId === person.id;
                  return (
                    <Pressable
                      key={person.id}
                      onPress={alreadyBooked ? undefined : () => setPatientId(person.id)}
                      disabled={alreadyBooked}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, disabled: alreadyBooked }}
                      style={[styles.person, selected && styles.personOn]}
                    >
                      <Icon
                        name={alreadyBooked ? 'check' : selected ? 'check-circle' : 'circle'}
                        size={20}
                        color={
                          alreadyBooked
                            ? theme.color.textDisabled
                            : selected
                              ? theme.color.primary
                              : theme.color.textDisabled
                        }
                      />
                      <Text style={[styles.personName, alreadyBooked && styles.personBooked]}>
                        {person.name}
                      </Text>
                      {/* Never colour alone (docs/Design.md 8) - say why it is greyed. */}
                      {alreadyBooked ? <Text style={styles.personNote}>Already booked</Text> : null}
                    </Pressable>
                  );
                })
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.feeRow}>
                <Text style={styles.feeLabel}>Consultation fee</Text>
                {/* The server's number. The app never computes or sends an amount. */}
                <Text style={styles.fee}>{rupees(detail.feePaise)}</Text>
              </View>
              <Text style={styles.meta}>
                Your place is held for a few minutes while you pay. You will get a token with a QR
                code to check in at reception.
              </Text>
            </View>

            {notice !== null && <ErrorNote message={notice} />}
            {join.error !== null && <ErrorNote message={join.error.message} />}

            <Button
              title={
                phase.name === 'confirming'
                  ? 'Confirming your payment...'
                  : selectable.length === 0
                    ? 'Everyone here is already booked'
                    : patientId === null
                      ? 'Choose who is visiting'
                      : `Pay ${rupees(detail.feePaise)}`
              }
              icon="credit-card"
              pending={join.isPending || phase.name === 'confirming'}
              // Cannot pay without a patient. Saying so beats a live-looking button
              // whose only behaviour is to ignore you.
              disabled={patientId === null || selectable.length === 0}
              onPress={startPayment}
            />
          </>
        )}
      </ScrollView>

      {/*
        Razorpay Checkout in a WebView.

        The official `react-native-razorpay` SDK is a NATIVE module, and Expo Go
        cannot load one - the SDK is pinned to Expo 54 deliberately (trap 5), so a
        native dependency would mean a development build before anything could be
        tested at all. Checkout's own web script is the supported way to do this
        inside Expo Go, and it is the same Razorpay-hosted flow.
      */}
      <Modal
        visible={phase.name === 'checkout'}
        animationType="slide"
        onRequestClose={() => closeCheckout()}
      >
        <View style={styles.modal}>
          <Pressable
            onPress={() => closeCheckout()}
            accessibilityRole="button"
            accessibilityLabel="Close payment"
            style={styles.close}
          >
            <Icon name="x" size={22} color={theme.color.text} />
          </Pressable>
          {phase.name === 'checkout' && (
            <WebView
              originWhitelist={['*']}
              javaScriptEnabled
              domStorageEnabled
              /*
                Netbanking sends the patient to their bank through `window.open`. On
                Android react-native-webview defaults this to TRUE, which creates a
                window that is never displayed - the sheet just sits there and the
                payment looks like it failed. `false` loads the bank page in this
                same WebView, which is the fix for netbanking.
              */
              setSupportMultipleWindows={false}
              javaScriptCanOpenWindowsAutomatically
              startInLoadingState
              renderLoading={() => (
                <View style={styles.loading}>
                  <ActivityIndicator color={theme.color.primary} />
                </View>
              )}
              onShouldStartLoadWithRequest={(request) => {
                // The gateway is finished and is handing the browser back. Stop the
                // navigation - there is nothing at that address - and go ask the
                // server what actually happened.
                if (request.url.startsWith(phase.order.callbackUrl)) {
                  leftOurPage.current = true;
                  setPhase((current) =>
                    current.name === 'checkout'
                      ? { name: 'confirming', entryId: current.order.entry.id }
                      : current,
                  );
                  return false;
                }
                // UPI-intent hands off to GPay/PhonePe through a custom scheme. A
                // WebView cannot load those; the OS can. Without this the sheet dies
                // on a URL it does not understand.
                if (!/^https?:/i.test(request.url)) {
                  void Linking.openURL(request.url).catch(() => undefined);
                  leftOurPage.current = true;
                  return false;
                }
                if (!request.url.startsWith(CHECKOUT_ORIGIN)) {
                  leftOurPage.current = true;
                }
                return true;
              }}
              onError={() => closeCheckout('The payment page could not be opened. Please try again.')}
              source={{
                html: checkoutHtml(phase.order, detail?.hospitalName ?? 'Consultation'),
                // A real https origin: Checkout refuses to run from about:blank,
                // which is what a bare `html` source gives it on Android.
                baseUrl: CHECKOUT_ORIGIN,
              }}
              onMessage={(event) => onCheckoutMessage(event.nativeEvent.data)}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

type CheckoutMessage = { type: 'success' | 'failed' | 'dismissed'; description?: string };

function safeParse(raw: string): CheckoutMessage | null {
  try {
    return JSON.parse(raw) as CheckoutMessage;
  } catch {
    return null;
  }
}

/**
 * The checkout page.
 *
 * `order_id` and `key` come from the server's join response - the app never names an
 * amount, and Razorpay takes the amount from the order itself, so there is nothing
 * here a tampered client could inflate or discount.
 */
function checkoutHtml(order: JoinResponse, hospitalName: string): string {
  const options = JSON.stringify({
    key: order.razorpayKeyId,
    order_id: order.razorpayOrderId,
    currency: order.currency,
    name: hospitalName,
    description: `${order.entry.departmentName} · Token ${order.entry.tokenLabel}`,
    theme: { color: theme.color.primary },
    /*
      REDIRECT MODE, and it is the whole reason netbanking works.

      By default Checkout sends the patient to their bank through `window.open`.
      React Native's WebView returns NULL from that call even with
      `setSupportMultipleWindows={false}` - it navigates, but JavaScript gets null
      back - and Checkout reads null as "popup blocked" and aborts with "payment
      failed, please use another method". Razorpay's own API told us so: every
      netbanking and wallet attempt sat at status `created`, never reaching the
      bank, while card - the one method that completes in-page - was `captured`.

      `redirect: true` navigates the top window instead of opening one, so no popup
      is ever needed. It applies to cards too, which is fine: this screen has not
      depended on Checkout's `handler` since it started polling the server from the
      moment the sheet opens.
    */
    redirect: true,
    callback_url: order.callbackUrl,
  });

  return `<!doctype html>
<html>
  <head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="margin:0;background:${theme.color.canvas}">
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
    <script>
      function post(message) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(message));
        }
      }
      var options = ${options};
      // Only fires in non-redirect mode. Harmless, and a free fast path if Razorpay
      // ever decides a given method does not need the redirect.
      options.handler = function () { post({ type: 'success' }); };
      options.modal = { ondismiss: function () { post({ type: 'dismissed' }); }, escape: false };
      try {
        var rzp = new Razorpay(options);
        rzp.on('payment.failed', function (event) {
          post({ type: 'failed', description: event && event.error && event.error.description });
        });
        rzp.open();
      } catch (error) {
        post({ type: 'failed', description: String(error) });
      }
    </script>
  </body>
</html>`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.canvas },
  content: { padding: theme.space[4], gap: theme.space[3], paddingBottom: theme.space[10] },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    padding: theme.space[4],
    gap: theme.space[2],
  },
  doctor: { ...theme.font.h3, color: theme.color.text },
  meta: { ...theme.font.caption, color: theme.color.textMuted },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[3],
    paddingVertical: theme.space[3],
    paddingHorizontal: theme.space[3],
    borderRadius: theme.radius.md,
    // docs/Design.md 9: 44x44 minimum.
    minHeight: 44,
  },
  personOn: { backgroundColor: theme.color.teal[50] },
  personName: { ...theme.font.body, color: theme.color.text },
  personBooked: { color: theme.color.textDisabled },
  personNote: { ...theme.font.caption, color: theme.color.textMuted, marginLeft: 'auto' },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  feeLabel: { ...theme.font.body, color: theme.color.textMuted },
  fee: { ...theme.font.h2, color: theme.color.text, fontVariant: ['tabular-nums'] },
  modal: { flex: 1, backgroundColor: theme.color.canvas },
  close: {
    alignSelf: 'flex-end',
    padding: theme.space[4],
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
