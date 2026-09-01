/**
 * A session with real bookings in it, built directly in Postgres.
 *
 * Why not through the API: a paid booking is created by the RAZORPAY WEBHOOK, and
 * standing up a real gateway order to test a console screen would make this depend
 * on a third party being reachable. `apps/api/test/console.e2e.test.ts` builds its
 * fixtures exactly this way and for the same reason.
 *
 * Nothing here is a production path - it writes rows the webhook would have written,
 * then the walkthrough drives the console over them like any other clinic.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Runs one statement in the dev database. `|`-separated rows, no headers. */
export function sql(statement) {
  const out = execFileSync(
    'docker',
    ['exec', '-i', 'opd-postgres', 'psql', '-U', 'opd', '-d', 'opd', '-t', '-A', '-F', '|', '-c', statement],
    { encoding: 'utf8' },
  );
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^\(\d+ rows?\)$/.test(line))
    .map((line) => line.split('|'));
}

const one = (statement) => sql(statement)[0];

/** The same secret the API signs with - so a QR built here is one it will accept. */
export function checkInSecret(envPath) {
  const line = readFileSync(envPath, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('CHECKIN_SECRET='));
  if (!line) throw new Error(`CHECKIN_SECRET missing from ${envPath}`);
  return line.slice('CHECKIN_SECRET='.length).trim().replace(/^["']|["']$/g, '');
}

/** Mirrors apps/api/src/common/checkin-code.ts. Must stay in step with it. */
export const signCheckInCode = (reference, secret) => {
  const signed = `v1.${reference}`;
  return `${signed}.${createHmac('sha256', secret).update(signed).digest('base64url').slice(0, 22)}`;
};

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * A fresh OPD session that started two hours ago, with `booked` paid bookings and
 * one unpaid hold. Started-in-the-past is deliberate: it puts the cancellation
 * policy past its free window, so the refund tier under test is the interesting one.
 */
export function createSession({ hospital = 'Apollo', booked = ['Anita Sharma', 'Rahul Verma', 'Priya Nair'], feePaise = 60000 }) {
  const [hospitalId, departmentId, doctorId, doctorName] = one(`
    SELECT h.id, d.id, doc.id, doc.name
      FROM "Hospital" h
      JOIN "Department" d ON d."hospitalId" = h.id
      JOIN "Doctor" doc ON doc."departmentId" = d.id
     WHERE h.name ILIKE ${quote(`${hospital}%`)}
     ORDER BY d.name, doc.name
     LIMIT 1`);

  const sessionId = randomUUID();
  sql(`
    INSERT INTO "OPDSession"
      (id, "hospitalId", "departmentId", "originalDoctorId", "currentProviderDoctorId",
       date, "scheduledStart", "scheduledEnd", status, "doctorPresence",
       "tokenPrefix", "feePaise", "updatedAt")
    VALUES (${quote(sessionId)}, ${quote(hospitalId)}, ${quote(departmentId)},
            ${quote(doctorId)}, ${quote(doctorId)},
            (now() AT TIME ZONE 'Asia/Kolkata')::date,
            now() - interval '2 hours', now() + interval '3 hours',
            'OPEN_FOR_REGISTRATION', 'NOT_PRESENT', 'A', ${feePaise}, now())`);

  const accountId = randomUUID();
  sql(`INSERT INTO "Account" (id, email, "updatedAt")
       VALUES (${quote(accountId)}, ${quote(`walkthrough-${accountId.slice(0, 8)}@patient.test`)}, now())`);

  const entries = booked.map((name, i) => {
    const tokenNumber = i + 1;
    const patientId = randomUUID();
    const entryId = randomUUID();
    const paymentId = randomUUID();
    // 24 random bytes, base64url - the shape the webhook mints (Phase 5).
    const reference = Buffer.from(randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''), 'hex')
      .toString('base64url')
      .slice(0, 32);

    sql(`INSERT INTO "Patient" (id, "accountId", name, relation, "updatedAt")
         VALUES (${quote(patientId)}, ${quote(accountId)}, ${quote(name)}, 'SELF', now())`);
    sql(`
      INSERT INTO "QueueEntry"
        (id, "hospitalId", "sessionId", "patientId", "accountId", "tokenNumber",
         "tokenLabel", type, priority, status, "checkInCode", "updatedAt")
      VALUES (${quote(entryId)}, ${quote(hospitalId)}, ${quote(sessionId)}, ${quote(patientId)},
              ${quote(accountId)}, ${tokenNumber}, ${quote(`A${String(tokenNumber).padStart(3, '0')}`)},
              'ONLINE', 'NORMAL', 'CONFIRMED', ${quote(reference)}, now())`);
    sql(`
      INSERT INTO "Payment"
        (id, "hospitalId", "queueEntryId", "accountId", "amountPaise", currency, status,
         "razorpayOrderId", "razorpayPaymentId", "updatedAt")
      VALUES (${quote(paymentId)}, ${quote(hospitalId)}, ${quote(entryId)}, ${quote(accountId)},
              ${feePaise}, 'INR', 'SUCCESS', ${quote(`order_${entryId}`)}, ${quote(`pay_${entryId}`)}, now())`);

    return { id: entryId, name, tokenNumber, tokenLabel: `A${String(tokenNumber).padStart(3, '0')}`, reference };
  });

  // An unpaid hold: it must show as a hold and never as somebody in the queue.
  const holdPatientId = randomUUID();
  const holdId = randomUUID();
  sql(`INSERT INTO "Patient" (id, "accountId", name, relation, "updatedAt")
       VALUES (${quote(holdPatientId)}, ${quote(accountId)}, 'Unpaid Hold', 'SELF', now())`);
  sql(`
    INSERT INTO "QueueEntry"
      (id, "hospitalId", "sessionId", "patientId", "accountId", "tokenNumber", "tokenLabel",
       type, priority, status, "reservationExpiresAt", "updatedAt")
    VALUES (${quote(holdId)}, ${quote(hospitalId)}, ${quote(sessionId)}, ${quote(holdPatientId)},
            ${quote(accountId)}, ${booked.length + 1},
            ${quote(`A${String(booked.length + 1).padStart(3, '0')}`)},
            'ONLINE', 'NORMAL', 'RESERVED', now() + interval '10 minutes', now())`);

  return { hospitalId, sessionId, doctorName, entries, holdId, feePaise };
}

/** One column off one row, for reading state back out of the database. */
export const columnOf = (table, id, column) =>
  one(`SELECT ${column} FROM "${table}" WHERE id = ${quote(id)}`)?.[0] ?? null;
