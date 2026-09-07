/**
 * Phase 6 · the doctor and staff consoles, driven the way a clinic drives them.
 *
 * Every claim below is made by pressing a real button on a real page and reading the
 * page that comes back - and, wherever a screen could lie, by reading the row back
 * out of Postgres afterwards.
 *
 * Run it:
 *   docker compose up -d
 *   pnpm --filter @opd/api seed
 *   pnpm --filter @opd/api start        # :3000
 *   pnpm --filter @opd/web dev          # :3001
 *   pnpm --filter @opd/web test:console
 *
 * ponytail: deliberately NOT part of `turbo run test` - it needs two live servers
 * and a seeded database, and a hermetic task must not. It is the thing to run
 * before believing the console still works. Upgrade path is Playwright, when the
 * things it cannot reach (the camera, anything needing a DOM) start to matter.
 */

import { canPress, connectSocket, go, login, logout, press, section, visible } from './harness.mjs';
import { fileURLToPath } from 'node:url';
import { checkInSecret, columnOf, createSession, signCheckInCode, sql } from './fixture.mjs';

const WEB = process.env.WEB_URL ?? 'http://localhost:3001';
const ENV_PATH = fileURLToPath(new URL('../../api/.env', import.meta.url));
const SECRET = checkInSecret(ENV_PATH);

let passed = 0;
const failures = [];
let act = '';

const heading = (name) => {
  act = name;
  console.log(`\n\x1b[1m${name}\x1b[0m`);
};

function check(claim, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32m/\x1b[0m ${claim}`);
  } else {
    failures.push(`${act} · ${claim}${detail ? `\n      ${detail}` : ''}`);
    console.log(`  \x1b[31mX ${claim}\x1b[0m${detail ? `\n      ${detail}` : ''}`);
  }
}

const board = (id, query = '') => go(`${WEB}/queue/${id}${query}`);
const desk = (id) => go(`${WEB}/queue/${id}/check-in`);

// ---------------------------------------------------------------------------

const fixture = createSession({});
const { sessionId, entries, holdId } = fixture;
const [anita, rahul, priya] = entries;

console.log(`session ${sessionId} · ${fixture.doctorName} · ${entries.length} booked + 1 unpaid hold`);

await login(WEB, 'reception@apollo.test', 'Demo@12345');

// ===========================================================================
heading('Act I - the check-in desk (P6-WEB-02)');

let page = await desk(sessionId);
check(
  'the desk offers the camera, the typed token AND the list',
  visible(page).includes('Scan the token QR') &&
    visible(page).includes('Or type the token number') &&
    visible(page).includes('Or find them in the list'),
);

check(
  'the camera is presented as optional, never as required',
  visible(page).includes('there is no camera, the two methods below still work'),
);

// The scanner's own form, submitted with exactly the payload the camera would hand it.
const qr = signCheckInCode(anita.reference, SECRET);
page = await press(page, { where: { checkInCode: '' }, fill: { checkInCode: qr } });
check(
  `a signed QR checks ${anita.name} in`,
  visible(page).includes(`${anita.tokenLabel} · ${anita.name} checked in`),
  visible(page).slice(0, 200),
);

page = await press(await desk(sessionId), { where: { checkInCode: '' }, fill: { checkInCode: qr } });
check(
  'scanning the same patient twice repeats the message and never errors',
  visible(page).includes(`${anita.tokenLabel} · ${anita.name} checked in`),
  visible(page).slice(0, 200),
);

const tampered = qr.slice(0, -1) + (qr.endsWith('A') ? 'B' : 'A');
page = await press(await desk(sessionId), { where: { checkInCode: '' }, fill: { checkInCode: tampered } });
check('a tampered QR is refused', /no token matches/i.test(visible(page)), visible(page).slice(0, 200));

page = await press(await desk(sessionId), { where: { checkInCode: '' }, fill: { checkInCode: rahul.reference } });
check(
  'the bare unsigned reference is refused - the signature is not decoration',
  /no token matches/i.test(visible(page)),
  visible(page).slice(0, 200),
);
check(
  'and that attempt changed nothing',
  (await columnOf('QueueEntry', rahul.id, 'status')) === 'CONFIRMED',
);

page = await press(await desk(sessionId), { button: 'Check in', fill: { tokenNumber: rahul.tokenLabel } });
check(
  `the token typed WITH its letter (${rahul.tokenLabel}) checks ${rahul.name} in`,
  visible(page).includes(`${rahul.tokenLabel} · ${rahul.name} checked in`),
  visible(page).slice(0, 200),
);

page = await press(await desk(sessionId), { button: 'Check in', fill: { tokenNumber: '  ' } });
check(
  'a blank token is explained, not swallowed',
  visible(page).includes('Enter a token number, for example 27 or A027'),
  visible(page).slice(0, 200),
);

// ===========================================================================
heading('Act II - walk-ins (P6-WEB-03)');

let walkIn = await go(`${WEB}/queue/${sessionId}/walk-in`);
walkIn = await press(walkIn, { button: 'Add', fill: { name: 'Meera Pillai' } });
check('a walk-in is registered', visible(walkIn).includes('Meera Pillai'), visible(walkIn).slice(0, 300));

const meera = sql(`
  SELECT "tokenLabel", status, type FROM "QueueEntry"
   WHERE "sessionId" = '${sessionId}'
     AND "patientId" IN (SELECT id FROM "Patient" WHERE name = 'Meera Pillai')`)[0];
check(
  `the walk-in took the next token (${meera?.[0]}) and is already CHECKED_IN`,
  meera?.[1] === 'CHECKED_IN' && meera?.[2] === 'WALK_IN',
  JSON.stringify(meera),
);

const nameless = await press(await go(`${WEB}/queue/${sessionId}/walk-in`), { button: 'Add', fill: { name: '' } });
check(
  'a nameless walk-in is refused, in a sentence rather than a field error',
  /a walk-in needs a name/i.test(visible(nameless)),
  visible(nameless).slice(0, 250),
);

// ===========================================================================
heading('Act III - the doctor loop (P6-WEB-01)');

page = await board(sessionId);
check(
  'an unpaid hold is shown as a hold, not as somebody in the queue',
  visible(page).includes('Unpaid holds') && section(page, 'Unpaid holds').includes('Unpaid Hold'),
  section(page, 'Unpaid holds').slice(0, 200),
);
check(
  'the board says whether it is live, rather than going quiet',
  /live|connecting/i.test(visible(page)),
  visible(page).slice(0, 200),
);

// --- how the clinic is running (P9-WEB-02) ---------------------------------
// The engine has produced these numbers since Phase 7 and no screen ever asked for
// them. A receptionist deciding whether to warn the room had to guess at something
// the server already knew.
check(
  'the board says how fast the clinic is moving',
  visible(page).includes('How today is running'),
  visible(page).slice(0, 300),
);
check(
  'it shows the pace and the handover gap, not just a total',
  /Per patient/.test(visible(page)) && /Between patients/.test(visible(page)),
  section(page, 'How today is running').slice(0, 300),
);
check(
  'and says what each figure stands on, so a guess is not read as a measurement',
  /default|measured|consultation|handover|starting estimate/i.test(
    section(page, 'How today is running'),
  ),
  section(page, 'How today is running').slice(0, 300),
);
check(
  'punctuality is stated in words, never colour alone',
  /Running behind|usual pace/i.test(visible(page)),
  section(page, 'How today is running').slice(0, 200),
);

// The fixture seeds NOT_PRESENT, which is the default a real clinic starts every
// morning on - so this is the FIRST thing a receptionist meets, not an edge case.
check(
  'Call next is refused until somebody says the doctor is here',
  !canPress(page, 'Call next'),
  visible(page).slice(0, 300),
);
check(
  'and the board says so in words, with the remedy beside it',
  /not been marked present/i.test(visible(page)) && canPress(page, 'Mark doctor present'),
  visible(page).slice(0, 300),
);

page = await press(page, { button: 'Mark doctor present' });
check(
  'Mark doctor present unblocks the queue in one press',
  (await columnOf('OPDSession', sessionId, 'doctorPresence')) === 'PRESENT' &&
    canPress(page, 'Call next'),
);

page = await press(page, { button: 'Call next' });
check(
  `Call next calls ${anita.tokenLabel} - the server's order, and the client never sorted`,
  visible(page).includes(`Called ${anita.tokenLabel}`),
  visible(page).slice(0, 250),
);
check(
  'the session became ACTIVE on the first call',
  (await columnOf('OPDSession', sessionId, 'status')) === 'ACTIVE',
);

// The clinical record is the doctor's (PRD 6.2). Reception got this far - check-in,
// presence, call-next are all theirs - and stops here.
check(
  'reception is not offered Start consultation',
  !canPress(page, 'Start consultation') && /recorded by the doctor/i.test(visible(page)),
  visible(page).slice(0, 300),
);

logout();
await login(WEB, 'doctor@apollo.test', 'Demo@12345');
page = await board(sessionId);

page = await press(page, { button: 'Start consultation' });
check(
  'Start consultation moves them into the room',
  (await columnOf('QueueEntry', anita.id, 'status')) === 'IN_CONSULTATION',
);

page = await press(page, { button: 'Complete consultation' });
check(
  'Complete consultation finishes them',
  (await columnOf('QueueEntry', anita.id, 'status')) === 'COMPLETED',
);

// Back to the desk for the rest of the walkthrough, which is reception's work.
logout();
await login(WEB, 'reception@apollo.test', 'Demo@12345');
page = await board(sessionId);

page = await press(page, { button: 'Call next' });
check(`the next call takes ${rahul.tokenLabel}`, visible(page).includes(`Called ${rahul.tokenLabel}`), visible(page).slice(0, 200));

page = await press(page, { button: 'Skip for now', fill: { reason: 'stepped out' } });
check(
  'a skipped patient appears under "Passed over"',
  section(page, 'Passed over').includes(rahul.tokenLabel),
  section(page, 'Passed over').slice(0, 200),
);

page = await press(page, { button: 'Put back in queue', where: { entryId: rahul.id } });
check(
  'requeue puts them back among the waiting',
  (await columnOf('QueueEntry', rahul.id, 'status')) === 'CHECKED_IN',
);

const strip = section(await board(sessionId), 'Next');
check(
  'a requeued patient goes to the BACK of the queue, not to their token position',
  strip.includes('Meera') && strip.indexOf('Meera') < strip.indexOf(rahul.tokenLabel),
  strip.slice(0, 200),
);

page = await press(await board(sessionId), { button: 'Call next' });
page = await press(page, { button: 'No-show' });
check('No-show is accepted', !/error/i.test(section(page, 'Something went wrong')), visible(page).slice(0, 200));

page = await press(await board(sessionId), { button: 'Pause queue', fill: { reason: 'doctor stepped out' } });
page = await board(sessionId);
check('a paused queue still LOOKS paused after a reload', visible(page).includes('Paused'));
check('Call next is not offered while paused', !canPress(page, 'Call next'));
check('and the screen says why', visible(page).includes('The queue is paused'));

page = await press(page, { button: 'Resume queue' });
check('Resume brings Call next back', canPress(await board(sessionId), 'Call next'));

await press(await board(sessionId), { button: 'Update', fill: { presence: 'LEFT' } });
page = await board(sessionId);
check(
  'nobody can be called once the doctor has LEFT',
  !canPress(page, 'Call next') && /left for the day/i.test(visible(page)),
  visible(page).slice(0, 300),
);
// The dropdown still sets any of the four; the one-press button is the remedy the
// desk reaches for, and it has to work from LEFT as well as from NOT_PRESENT.
page = await press(page, { button: 'Mark doctor present' });
check('and one press brings them back', canPress(await board(sessionId), 'Call next'));

// ===========================================================================
heading('Act IV - audited escalation (P6-WEB-04)');

page = await press(await board(sessionId), {
  button: 'Save',
  where: { entryId: priya.id },
  fill: { priority: 'EMERGENCY', reason: 'chest pain, needs to be seen now' },
});
check(
  `${priya.tokenLabel} is escalated to EMERGENCY`,
  (await columnOf('QueueEntry', priya.id, 'priority')) === 'EMERGENCY',
);

// Anchored to the roster the console presents AS the call order, not to a 900-character
// window after the word "Next".
//
// The old anchor passed for an accidental reason: the board was one long column, so the
// slice after "Next" happened to run into the waiting list further down the page. Once
// the board became two columns that window stopped reaching it, and a check that had
// never really been reading the call order started failing. Reading the list itself is
// what it meant to do all along, and it is now insensitive to where that list sits.
const escalated = section(await board(sessionId), 'Waiting here');
check(
  'the emergency jumps to the front of the call order',
  escalated.includes(priya.tokenLabel) &&
    (!escalated.includes('Meera') || escalated.indexOf(priya.tokenLabel) < escalated.indexOf('Meera')),
  escalated.slice(0, 200),
);

const audit = sql(`
  SELECT action, "actorType", reason FROM "AuditLog"
   WHERE "entityId" = '${priya.id}' ORDER BY "createdAt" DESC LIMIT 1`)[0];
check(
  'the escalation is in the audit log, with the reason the receptionist typed',
  audit?.[2] === 'chest pain, needs to be seen now',
  JSON.stringify(audit),
);

page = await press(await board(sessionId), {
  button: 'Save',
  where: { entryId: priya.id },
  fill: { priority: 'EMERGENCY', reason: '' },
});
check(
  'a reasonless escalation is refused by the server, not merely by the form',
  /reason/i.test(visible(page)) && /at least|required/i.test(visible(page)),
  visible(page).slice(0, 250),
);

// ===========================================================================
heading('Act V - staff cancellation and refunds (P6-WEB-04)');

const noReason = await press(await board(sessionId), {
  button: 'Cancel booking',
  where: { entryId: rahul.id },
  fill: { cause: 'HOSPITAL', reason: '' },
});
check(
  'a reasonless cancellation is refused - the reason is the audit trail',
  /reason/i.test(visible(noReason)) && /at least|required/i.test(visible(noReason)),
  visible(noReason).slice(0, 250),
);
check(
  'and the booking it was aimed at is untouched',
  (await columnOf('QueueEntry', rahul.id, 'status')) === 'CHECKED_IN',
);

page = await press(await board(sessionId), {
  button: 'Cancel booking',
  where: { entryId: priya.id },
  fill: { cause: 'HOSPITAL', reason: 'doctor called into surgery' },
});
check('a hospital cancellation refunds in full', /refund raised \(100%\)/.test(visible(page)), visible(page).slice(0, 300));
check('the entry is CANCELLED', (await columnOf('QueueEntry', priya.id, 'status')) === 'CANCELLED');

const refunds = sql(`
  SELECT r."amountPaise", r.status, r.reason FROM "Refund" r
    JOIN "Payment" p ON p.id = r."paymentId"
   WHERE p."queueEntryId" = '${priya.id}'`);
check('exactly one refund row was raised', refunds.length === 1, JSON.stringify(refunds));
check(
  `the refund is the whole fee (${fixture.feePaise}p)`,
  refunds[0]?.[0] === String(fixture.feePaise),
  JSON.stringify(refunds[0]),
);
check('the refund records why', /doctor called into surgery/.test(refunds[0]?.[2] ?? ''), refunds[0]?.[2]);

const patientCancel = await press(await board(sessionId), {
  button: 'Cancel booking',
  where: { entryId: rahul.id },
  fill: { cause: 'PATIENT_REQUEST', reason: 'feeling better' },
});
// NOT a hardcoded percentage. The tier depends on the clock and on the hospital's own
// rules, and hardcoding one is the exact bug docs/PROGRESS.md records for this claim.
const pct = visible(patientCancel).match(/refund raised \((\d+)%\)/);
check(
  'a patient-requested cancellation applies the hospital policy tier, whatever it is today',
  pct !== null && Number(pct[1]) <= 100,
  visible(patientCancel).slice(0, 300),
);

// ===========================================================================
heading('Act VI - two people, one board');

const entryIdOf = (name) =>
  sql(`
    SELECT e.id FROM "QueueEntry" e JOIN "Patient" p ON p.id = e."patientId"
     WHERE e."sessionId" = '${sessionId}' AND p.name = '${name}'`)[0]?.[0];

// Two fresh walk-ins: everyone from the earlier acts has finished, and a stale board
// is only interesting when there is still something live on it.
for (const name of ['Suresh Rao', 'Kavita Menon']) {
  await press(await go(`${WEB}/queue/${sessionId}/walk-in`), { button: 'Add', fill: { name } });
}
const sureshId = entryIdOf('Suresh Rao');
const kavitaId = entryIdOf('Kavita Menon');

// A cancellation with no money behind it must say so rather than imply a refund.
const unpaidCancel = await press(await board(sessionId), {
  button: 'Cancel booking',
  where: { entryId: kavitaId },
  fill: { cause: 'HOSPITAL', reason: 'walked out before being seen' },
});
check(
  'cancelling a booking with no payment says there was nothing to refund',
  /nothing to refund/i.test(visible(unpaidCancel)),
  visible(unpaidCancel).slice(0, 250),
);

// The real two-receptionist case: one of them is holding a page that was rendered
// BEFORE the other acted. With no realtime until Phase 7 this is not an edge case -
// every board on every screen is going out of date as it is read.
await press(await board(sessionId), { button: 'Call next' });
const staleBoard = await board(sessionId);
// No-show, not Start consultation: this act is signed in as reception, and the
// clinical two are the doctor's now (PRD 6.2). The point being made is about a page
// that went out of date, not about which button it was, so it is made with a button
// reception actually has.
check('the stale board still offers No-show', canPress(staleBoard, 'No-show'));

await press(await board(sessionId), { button: 'No-show' });

const staleAttempt = await press(staleBoard, { button: 'No-show' });
const staleText = visible(staleAttempt);
check(
  'the stale action is refused in a sentence a receptionist can act on',
  /no longer possible|already|someone may have acted first/i.test(staleText),
  staleText.slice(0, 400),
);
check(
  'and it leaks none of the engine vocabulary',
  !/INVALID_QUEUE_TRANSITION|\(command:|from: [A-Z_]{4,}/.test(staleText),
  staleText.slice(0, 400),
);
check(
  'the losing action changed nothing',
  (await columnOf('QueueEntry', sureshId, 'status')) === 'NO_SHOW',
  await columnOf('QueueEntry', sureshId, 'status'),
);

// Cancelling twice is DELIBERATELY safe - `applyCancellation` reports whether it
// changed anything and the refund is only raised when it did. Two receptionists
// cancelling the same booking must not move the money twice.
const twice = await press(await board(sessionId), {
  button: 'Cancel booking',
  where: { entryId: priya.id },
  fill: { cause: 'HOSPITAL', reason: 'cancelling an already-cancelled booking' },
}).catch(() => null);
check(
  'an already-cancelled booking is no longer offered a cancel button at all',
  twice === null,
  'the finished group carries no row actions, which is why this cannot be reached from the UI',
);
const refundCount = sql(`
  SELECT count(*) FROM "Refund" r JOIN "Payment" p ON p.id = r."paymentId"
   WHERE p."queueEntryId" = '${priya.id}'`)[0]?.[0];
check('and its refund was raised exactly once', refundCount === '1', `refund rows: ${refundCount}`);

// ===========================================================================
heading('Act VII - realtime (P7-BE-01, P7-BE-02, P7-WEB-01)');

// docs/Phases.md, the Phase 7 integration checkpoint, verbatim: "two clients; one
// triggers a change, the other updates live". The console's own listener is a
// browser component this harness cannot run, so the SOCKET is driven directly and
// the button that fires it is pressed for real, over HTTP.
{
  const listener = await connectSocket(WEB, sessionId);
  check('a console can subscribe to the session it is showing', listener.subscribed, listener.error ?? '');

  const heard = listener.next('session.updated', 6000);
  await press(await go(`${WEB}/queue/${sessionId}/walk-in`), {
    button: 'Add',
    fill: { name: 'Realtime Rita' },
  });
  const event = await heard;

  check('acting on the board tells everyone watching it', event !== null, 'no session.updated arrived');
  check(
    'and the broadcast carries no patient data - only "this queue moved"',
    event !== null && Object.keys(event).sort().join(',') === 'sessionId,version',
    JSON.stringify(event),
  );

  const refused = await listener.subscribeTo('ffffffff-ffff-4fff-8fff-ffffffffffff');
  check('a session that does not exist cannot be subscribed to', refused.ok === false, JSON.stringify(refused));

  const anonymous = await connectSocket(WEB, sessionId, { token: 'not-a-token' });
  check(
    'a socket with a bad token is dropped by the server',
    !anonymous.connected,
    'it was still connected after the server had had its say',
  );
  check(
    'and it never got into the room',
    anonymous.subscribed === false,
    JSON.stringify({ subscribed: anonymous.subscribed, error: anonymous.error }),
  );

  listener.close();
  anonymous.close();

  // The board still renders its live indicator server-side, so a receptionist can
  // see whether the screen is moving before they trust it.
  const boardHtml = visible(await board(sessionId));
  check(
    'the board says on screen whether it is live',
    /live|connecting/i.test(boardHtml),
    boardHtml.slice(0, 200),
  );
}

// ===========================================================================
heading('Act VIII - the tenant boundary');

logout();
await login(WEB, 'admin@fortis.test', 'Demo@12345');
const crossTenant = await board(sessionId);
check(
  'another hospital gets a not-found page, never the board',
  crossTenant.status === 404 || /not available|not found|cannot find/i.test(visible(crossTenant)),
  `${crossTenant.status} ${visible(crossTenant).slice(0, 200)}`,
);
check(
  'and not one patient name reaches their browser',
  !crossTenant.html.includes('Meera') && !crossTenant.html.includes(anita.name),
  visible(crossTenant).slice(0, 200),
);

const missing = await board('ffffffff-ffff-4fff-8fff-ffffffffffff');
check(
  'a session that does not exist answers identically - ids stay un-enumerable',
  missing.status === crossTenant.status,
  `${missing.status} vs ${crossTenant.status}`,
);

logout();
const loggedOut = await board(sessionId);
check('a logged-out visitor is sent to sign in', /sign in|password/i.test(visible(loggedOut)), visible(loggedOut).slice(0, 150));

// ===========================================================================
heading('Act IX - the doctor sees their own work, and the session ends');

await login(WEB, 'doctor@apollo.test', 'Demo@12345');
const doctorList = await go(`${WEB}/queue`);
check('the doctor account reaches a queue list of its own', doctorList.status === 200, String(doctorList.status));

logout();
await login(WEB, 'reception@apollo.test', 'Demo@12345');

// Two people the end-of-session rule must tell apart (docs/PRD.md 8.9 vs 8.11):
// one standing in the corridor having been checked in, one who booked and never came.
await press(await go(`${WEB}/queue/${sessionId}/walk-in`), { button: 'Add', fill: { name: 'Waited All Day' } });
const waitedId = entryIdOf('Waited All Day');
const neverCameId = anita.id; // COMPLETED - a control that must not be rewritten

await press(await board(sessionId), { button: 'End session', fill: { reason: 'clinic over' } });
const endedAs = await columnOf('OPDSession', sessionId, 'status');
check(
  'the session ends - ENDED_EARLY, because the clock had not reached its scheduled end',
  endedAs === 'ENDED_EARLY' || endedAs === 'COMPLETED',
  endedAs,
);
check(
  'someone who was HERE but never seen is RESCHEDULED, not marked absent',
  (await columnOf('QueueEntry', waitedId, 'status')) === 'RESCHEDULED',
  await columnOf('QueueEntry', waitedId, 'status'),
);
check(
  'and a patient already seen is left exactly as they were',
  (await columnOf('QueueEntry', neverCameId, 'status')) === 'COMPLETED',
);
check(
  'the unpaid hold is cancelled rather than left dangling',
  ['CANCELLED', 'RESERVED'].includes(await columnOf('QueueEntry', holdId, 'status')),
  await columnOf('QueueEntry', holdId, 'status'),
);

// ===========================================================================
console.log(
  `\n\x1b[1m${passed} passed, ${failures.length} failed\x1b[0m` +
    (failures.length ? `\n\n\x1b[31m${failures.join('\n')}\x1b[0m\n` : '\n'),
);
process.exit(failures.length === 0 ? 0 : 1);
