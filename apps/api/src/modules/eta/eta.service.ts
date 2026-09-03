import { Injectable } from '@nestjs/common';
import type { SessionEta } from '@opd/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundError } from '../../common/errors';
import { istToUtc, istToday } from '../../common/ist';
import { ELIGIBLE_TO_CALL } from '../queue/state-machine';
import {
  blendExpectedMins,
  etaWindow,
  isRunningBehind,
  measureDeadTime,
  type DeadTimeResult,
  type ExpectedResult,
} from './eta.engine';

/**
 * P7-BE-03 · the ETA engine's connection to the database.
 *
 * The arithmetic lives next door in `eta.engine.ts` and is pure. This file does one
 * job: gather the inputs **in a fixed number of queries no matter how many sessions
 * are asked about**. That constraint is the whole design. The patient-facing session
 * card is the hottest read path in the product, `discovery` renders a page of them
 * at a time, and an ETA that cost one query per card would undo the batching that
 * module exists to do.
 *
 * **It reads `Consultation` and `Doctor`, which other modules write.** That is the
 * same recorded exception `discovery` and `payments/my-entry` have (docs/CLAUDE.md 3,
 * docs/Architecture.md 4.1): read-only, writes nothing, exports a service rather than
 * a table. `Consultation` exists solely so this can learn from it - Phase 4's
 * complete-consultation command writes it for no other reader - and `Doctor` is read
 * for one integer, `defaultConsultMins`, which is documented in the schema as the
 * *"seed for ETA cold-start"*. Routing either through a tenant-scoped staff service
 * would fail for the patient who has no membership anywhere.
 */

/**
 * One question for the engine, assembled by the caller from data it already holds.
 *
 * `key` is whatever the caller wants the answer filed under - a sessionId for the
 * discovery cards ("when would someone joining now be seen"), an entryId for a
 * patient's own token ("when will *I* be seen"). Both are the same arithmetic over
 * a different `aheadCount`, so they are the same call.
 */
export interface EtaRequest {
  key: string;
  /**
   * The session being queued in. Needed because handover time is measured per
   * session, not per doctor - it is a property of the room and the day, and it is
   * what stops a patient's estimate disagreeing with the staff board's.
   */
  sessionId: string;
  /** The CURRENT provider, never the originally booked doctor (docs/PRD.md 8.11). */
  doctorId: string;
  /** How many patients will be seen before the person being estimated for. */
  aheadCount: number;
  /** When the consultation in progress began; null when nobody is in the room. */
  currentStartedAt: Date | null;
  /**
   * Whether an estimate means anything at all. A session that has ended, or whose
   * doctor has left, gets `null` rather than a number - docs/Phases.md is explicit
   * that a cold case must be answered honestly rather than papered over.
   */
  estimable: boolean;
}

export interface EtaWindowOut {
  from: string;
  to: string;
}

/** One doctor's measured pace. */
interface Pace {
  seedMins: number;
  allTimeMins: number | null;
  allTimeSamples: number;
  todayMins: number | null;
  todaySamples: number;
}

@Injectable()
export class EtaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Windows for any number of sessions, in three queries.
   *
   * Returns a map keyed by `key`; anything that cannot be estimated for is present
   * with `null` rather than absent, so a caller can tell "no estimate" from "you
   * forgot to ask".
   */
  async windowsFor(
    inputs: EtaRequest[],
    now: Date = new Date(),
  ): Promise<Map<string, EtaWindowOut | null>> {
    const out = new Map<string, EtaWindowOut | null>(inputs.map((i) => [i.key, null]));
    const estimable = inputs.filter((i) => i.estimable);
    if (estimable.length === 0) return out;

    const [paces, deadTimes] = await Promise.all([
      this.pacesFor([...new Set(estimable.map((i) => i.doctorId))], now),
      this.deadTimesFor([...new Set(estimable.map((i) => i.sessionId))]),
    ]);

    for (const input of estimable) {
      const pace = paces.get(input.doctorId);
      if (pace === undefined) continue;

      const expected = blendExpectedMins(pace);
      const window = etaWindow(
        expected.mins,
        {
          aheadCount: input.aheadCount,
          currentElapsedSec:
            input.currentStartedAt === null
              ? null
              : Math.round((now.getTime() - input.currentStartedAt.getTime()) / 1000),
        },
        now,
        (deadTimes.get(input.sessionId) ?? measureDeadTime([])).mins,
      );
      out.set(input.key, { from: window.from.toISOString(), to: window.to.toISOString() });
    }

    return out;
  }

  /**
   * The staff read behind `GET /sessions/:sessionId/eta` - what the engine is
   * estimating from, and whether today is running behind (docs/PRD.md 195).
   *
   * `hospitalId` is in the WHERE clause even though TenantGuard already resolved it
   * from this session: a by-id fetch verifies the row belongs to the caller's
   * hospital, always (docs/Rules.md 1.3).
   */
  async sessionEta(sessionId: string, hospitalId: string, now: Date = new Date()): Promise<SessionEta> {
    const session = await this.prisma.oPDSession.findFirst({
      where: { id: sessionId, hospitalId },
      select: {
        id: true,
        status: true,
        doctorPresence: true,
        currentProviderDoctorId: true,
      },
    });
    if (session === null) throw new NotFoundError('Session not found');

    const [pace, ahead, serving] = await Promise.all([
      this.pacesFor([session.currentProviderDoctorId], now).then(
        (map) => map.get(session.currentProviderDoctorId),
      ),
      this.prisma.queueEntry.count({
        where: { sessionId, status: { in: [...ELIGIBLE_TO_CALL] } },
      }),
      this.prisma.queueEntry.findFirst({
        where: { sessionId, status: 'IN_CONSULTATION' },
        select: { consultStartedAt: true },
      }),
    ]);

    const resolved: Pace = pace ?? {
      seedMins: 0,
      allTimeMins: null,
      allTimeSamples: 0,
      todayMins: null,
      todaySamples: 0,
    };
    const expected: ExpectedResult = blendExpectedMins(resolved);
    const deadTime = await this.deadTimeFor(sessionId);

    const window = ETA_IS_MEANINGFUL.has(session.status) && session.doctorPresence !== 'LEFT'
      ? etaWindow(
          expected.mins,
          {
            aheadCount: ahead,
            currentElapsedSec:
              serving?.consultStartedAt == null
                ? null
                : Math.round((now.getTime() - serving.consultStartedAt.getTime()) / 1000),
          },
          now,
          deadTime.mins,
        )
      : null;

    return {
      sessionId,
      expectedConsultMins: Number(expected.mins.toFixed(1)),
      basis: expected.basis,
      sampleSize: expected.sampleSize,
      runningBehind: isRunningBehind({
        todayMins: resolved.todayMins,
        todaySamples: resolved.todaySamples,
        // Against the doctor's OWN history, not today's blend - comparing today
        // against a number today is already half of would flatten the signal.
        baselineMins: resolved.allTimeMins ?? resolved.seedMins,
      }),
      deadTimeMins: Number(deadTime.mins.toFixed(1)),
      deadTimeBasis: deadTime.basis,
      deadTimeSamples: deadTime.sampleSize,
      joinNowEtaFrom: window === null ? null : window.from.toISOString(),
      joinNowEtaTo: window === null ? null : window.to.toISOString(),
    };
  }

  /**
   * How long this session takes to hand over from one patient to the next.
   *
   * The gap between a consultation ending and the next patient being called is real
   * - somebody has to walk in from the waiting room - and the engine used to model
   * none of it, which made every estimate optimistic in proportion to the queue
   * length. Both timestamps were already being recorded; nothing had ever read them.
   *
   * **Measured per session, not per doctor.** Turnaround is a property of the room
   * and the day: who is fetching patients, how far the waiting area is, how busy
   * reception is. The same doctor in a different clinic hands over differently, so a
   * doctor's history from last month says little about this morning.
   *
   * Computed in Node rather than SQL because it is a window function over pairs of
   * consecutive rows, and a session's entries number in the tens - there is nothing
   * here worth the raw SQL that docs/Rules.md keeps for locking and reporting.
   */
  private async deadTimeFor(sessionId: string): Promise<DeadTimeResult> {
    const all = await this.deadTimesFor([sessionId]);
    return all.get(sessionId) ?? measureDeadTime([]);
  }

  /** The same measurement for many sessions, in one query. */
  private async deadTimesFor(sessionIds: string[]): Promise<Map<string, DeadTimeResult>> {
    const out = new Map<string, DeadTimeResult>();
    if (sessionIds.length === 0) return out;

    const finished = await this.prisma.queueEntry.findMany({
      where: {
        sessionId: { in: sessionIds },
        calledAt: { not: null },
        completedAt: { not: null },
      },
      select: { sessionId: true, calledAt: true, completedAt: true },
      orderBy: [{ sessionId: 'asc' }, { calledAt: 'asc' }],
    });

    const bySession = new Map<string, { calledAt: Date; completedAt: Date }[]>();
    for (const row of finished) {
      if (row.calledAt === null || row.completedAt === null) continue;
      const list = bySession.get(row.sessionId) ?? [];
      list.push({ calledAt: row.calledAt, completedAt: row.completedAt });
      bySession.set(row.sessionId, list);
    }

    for (const sessionId of sessionIds) {
      const rows = bySession.get(sessionId) ?? [];
      const gaps: number[] = [];
      for (let i = 1; i < rows.length; i += 1) {
        const previousDone = rows[i - 1]!.completedAt;
        const nextCalled = rows[i]!.calledAt;
        gaps.push((nextCalled.getTime() - previousDone.getTime()) / 60_000);
      }
      out.set(sessionId, measureDeadTime(gaps));
    }

    return out;
  }

  /**
   * Every doctor's pace, in three queries for the whole set.
   *
   * `_avg` and `_count` in one `groupBy` per window rather than pulling durations
   * back and averaging in Node: the database has an index on `(doctorId, endedAt)`
   * and there is no reason to move thousands of rows to compute two numbers.
   */
  private async pacesFor(doctorIds: string[], now: Date): Promise<Map<string, Pace>> {
    if (doctorIds.length === 0) return new Map();

    // Midnight IST, expressed as the UTC instant it actually is. `new Date()` sliced
    // to a date string would be the UTC day, which between 00:00 and 05:30 IST is
    // yesterday - the bug this codebase has now hit twice (docs/PROGRESS.md).
    const startOfToday = istToUtc(istToday(now), '00:00');

    const [doctors, allTime, today] = await Promise.all([
      this.prisma.doctor.findMany({
        where: { id: { in: doctorIds } },
        select: { id: true, defaultConsultMins: true },
      }),
      this.prisma.consultation.groupBy({
        by: ['doctorId'],
        where: { doctorId: { in: doctorIds } },
        _avg: { durationSec: true },
        _count: { _all: true },
      }),
      this.prisma.consultation.groupBy({
        by: ['doctorId'],
        where: { doctorId: { in: doctorIds }, endedAt: { gte: startOfToday } },
        _avg: { durationSec: true },
        _count: { _all: true },
      }),
    ]);

    const minsOf = (seconds: number | null): number | null =>
      seconds === null ? null : seconds / 60;

    const allTimeBy = new Map(allTime.map((row) => [row.doctorId, row]));
    const todayBy = new Map(today.map((row) => [row.doctorId, row]));

    return new Map(
      doctors.map((doctor) => {
        const ever = allTimeBy.get(doctor.id);
        const now_ = todayBy.get(doctor.id);
        return [
          doctor.id,
          {
            seedMins: doctor.defaultConsultMins,
            allTimeMins: minsOf(ever?._avg.durationSec ?? null),
            allTimeSamples: ever?._count._all ?? 0,
            todayMins: minsOf(now_?._avg.durationSec ?? null),
            todaySamples: now_?._count._all ?? 0,
          },
        ];
      }),
    );
  }
}

/**
 * Statuses where a wait can be estimated at all. A COMPLETED or CANCELLED session has
 * no queue to join, and SCHEDULED has not opened - saying "about 20 minutes" for any
 * of them would be inventing a number.
 */
const ETA_IS_MEANINGFUL = new Set(['OPEN_FOR_REGISTRATION', 'ACTIVE']);
