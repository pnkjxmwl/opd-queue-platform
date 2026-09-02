import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  ActorType,
  DoctorPresence,
  Paginated,
  QueuePolicy,
  QueueEntryView,
  QueueEventType,
  SessionQueueQuery,
  SessionStatus,
} from '@opd/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundError, TenantMismatchError } from '../../common/errors';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { assertSessionAccepts, type QueueCommand } from './state-machine';
import { CALL_ORDER } from './call-order';
import { toEntryView } from './commands/result';
import { QueuePolicyService } from '../config/queue-policy.service';

/**
 * The transaction, locking and accountability skeleton every queue command runs
 * inside (P4-BE-02, docs/Architecture.md 7).
 *
 * Commands do not open their own transactions and do not take their own locks.
 * They are handlers passed to `runCommand`, which guarantees - identically, for all
 * twelve of them - that:
 *
 *   1. the SESSION row is locked `FOR UPDATE`, first, before anything is read
 *   2. the session belongs to the caller's hospital (docs/Rules.md 1.3)
 *   3. the state machine has approved the command against the session
 *   4. the mutation, the `QueueEvent` and the `AuditLog` all commit together
 *   5. `OPDSession.version` is bumped, so a stale client knows to refetch
 *
 * **Why the lock is here and not in each command.** docs/Phases.md names it as the
 * risk of this phase: one command that forgets `FOR UPDATE` silently defeats the
 * whole scheme, and the bug only appears under real concurrency, in a hospital. A
 * command physically cannot forget a lock it never takes.
 *
 * **Always the session row, always first.** Locking in a consistent order is what
 * prevents deadlocks between commands touching the same entries from different
 * directions. There is exactly one lock and it is this one.
 *
 * **Nothing slow happens inside.** No Razorpay call, no push notification, no socket
 * emit - a transaction held open across a network call is a throughput collapse
 * waiting to happen. Phase 7 emits realtime AFTER `$transaction` resolves, using the
 * events collected below; a rollback must never produce a "ghost update" telling a
 * patient they were called when the database disagrees.
 */

/** Who is running the command, resolved server-side. Never from the request body. */
export interface QueueActor {
  /** Account id of the human acting; null for a background job. */
  accountId: string | null;
  /** The hospital the caller acts within, from their HospitalStaff membership. */
  hospitalId: string;
  type: ActorType;
}

/** The locked session row, as commands see it. */
export interface LockedSession {
  id: string;
  hospitalId: string;
  departmentId: string;
  currentProviderDoctorId: string;
  status: SessionStatus;
  doctorPresence: DoctorPresence;
  tokenPrefix: string;
  /**
   * Read under the lock so the amount a join charges cannot change between the
   * decision and the Razorpay order. The fee NEVER comes from a request
   * (docs/Rules.md 9) and this row is the only place it is read from.
   */
  feePaise: number;
  scheduledStart: Date;
  scheduledEnd: Date;
  registrationClosedAt: Date | null;
  pausedAt: Date | null;
  version: number;
}

/** One accountability record: a queue event and its audit log, written together. */
export interface RecordInput {
  type: QueueEventType;
  /** The entry this happened to, or null for a session-level event. */
  entryId?: string | null;
  /** Required for the actions docs/PRD.md 8.7 says must carry one. */
  reason?: string | null;
  metadata?: Prisma.InputJsonObject;
}

/**
 * The session fields a command may change. Deliberately a small named set rather
 * than Prisma's full update input: a command has no business editing the fee, the
 * date or the doctor, and the queue engine is not the place those get changed.
 */
export interface SessionPatch {
  status?: SessionStatus;
  doctorPresence?: DoctorPresence;
  pausedAt?: Date | null;
  registrationClosedAt?: Date | null;
}

export interface CommandContext {
  /** The transaction. Commands must use this, never the root PrismaService. */
  tx: Prisma.TransactionClient;
  /**
   * The locked session. `patchSession` updates this in place, so it always reflects
   * what the command has decided so far - which is what the command's result is
   * built from. `version` is the value that was READ; the row will be one higher.
   */
  session: LockedSession;
  actor: QueueActor;
  /** One clock reading for the whole command, so its timestamps agree with each other. */
  now: Date;
  /**
   * The hospital's queue rules, fetched through ConfigModule's service rather than
   * its table (docs/CLAUDE.md 3). Loaded once per command, BEFORE the transaction
   * opens: it is configuration, not queue state, so it does not belong under the
   * session lock and must not lengthen the transaction.
   *
   * Every threshold a command needs - recall attempts, grace, whether walk-ins or
   * priority are allowed - lives here. No command hardcodes one.
   */
  policy: QueuePolicy;
  /** Change the session. Applied to `ctx.session` at once and written once, at the end. */
  patchSession(data: SessionPatch): void;
  /** Append to the timeline. Writes a QueueEvent AND an AuditLog (docs/Rules.md 1.7). */
  record(input: RecordInput): void;
  /**
   * Fetch an entry, verifying it belongs to THIS session. Never fetch an entry by id
   * alone: an id from a request body is attacker-controlled, and a bare lookup is
   * how one hospital's console reaches another's queue (IDOR, docs/Rules.md 1.3).
   */
  entryInSession(entryId: string): Promise<QueueEntryRow>;
}

export type QueueEntryRow = Prisma.QueueEntryGetPayload<{
  include: { patient: { select: { id: true; name: true } } };
}>;

const ENTRY_INCLUDE = { patient: { select: { id: true, name: true } } } as const;

/**
 * Long enough for a command that touches a few rows, short enough that a stuck
 * transaction surfaces as an error rather than a queue nobody can operate. The wait
 * for the session lock itself happens inside the transaction and counts against it,
 * which is the behaviour we want: a command that cannot get the lock in ten seconds
 * is a command the hospital should be told about.
 */
const TRANSACTION_TIMEOUT_MS = 10_000;
const TRANSACTION_MAX_WAIT_MS = 15_000;

@Injectable()
export class QueueService {
  private readonly log = new Logger(QueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: QueuePolicyService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Run one domain command against one session.
   *
   * The handler's return value is the command's result. Anything it throws rolls the
   * whole transaction back, including the audit trail - which is correct: an action
   * that did not happen must not be recorded as if it did.
   */
  async runCommand<T>(params: {
    sessionId: string;
    actor: QueueActor;
    command: QueueCommand;
    /** Audited reason, for the commands that require one. */
    reason?: string | null;
    handler: (ctx: CommandContext) => Promise<T>;
  }): Promise<T> {
    const { sessionId, actor, command } = params;
    const now = new Date();

    // Outside the transaction on purpose: configuration, not queue state. It also
    // creates the row on first use, and an upsert has no business running under a
    // lock that other staff are waiting on.
    const policy = await this.policies.ensure(actor.hospitalId);

    // Assigned inside the transaction, read AFTER it commits. Realtime is emitted
    // from out here for the reason docs/Phases.md puts first among this phase's
    // risks: an event sent inside a transaction that then rolls back tells a patient
    // they were called while the database says otherwise.
    let touchedEntryIds: string[] = [];
    let committedVersion = 0;

    const result = await this.prisma.$transaction(
      async (tx) => {
        const session = await lockSession(tx, sessionId);
        if (session === null) {
          throw new NotFoundError('Session not found');
        }

        // Tenancy before anything else is revealed about the row. A caller from
        // another hospital gets the same 403 whether or not the session exists.
        if (session.hospitalId !== actor.hospitalId) {
          throw new TenantMismatchError();
        }

        // The state machine is the only thing that decides whether this is allowed.
        assertSessionAccepts(command, session);

        let sessionPatch: SessionPatch = {};
        const records: RecordInput[] = [];

        const ctx: CommandContext = {
          tx,
          session,
          actor,
          now,
          policy,
          patchSession: (data) => {
            sessionPatch = { ...sessionPatch, ...data };
            Object.assign(session, data);
          },
          record: (input) => {
            records.push(input);
          },
          entryInSession: async (entryId) => {
            const entry = await tx.queueEntry.findFirst({
              where: { id: entryId, sessionId },
              include: ENTRY_INCLUDE,
            });
            if (entry === null) {
              throw new NotFoundError('Queue entry not found in this session');
            }
            return entry;
          },
        };

        const result = await params.handler(ctx);

        // One update: whatever the command changed, plus the version bump it cannot
        // forget because it never writes it.
        await tx.oPDSession.update({
          where: { id: sessionId },
          data: { ...sessionPatch, version: { increment: 1 } },
        });

        await writeRecords(tx, {
          session,
          actor,
          command,
          now,
          reason: params.reason ?? null,
          records,
        });

        // The version the row now holds: `session.version` is the value that was
        // READ under the lock, and the update above incremented it.
        committedVersion = session.version + 1;
        touchedEntryIds = [
          ...new Set(
            records
              .map((r) => r.entryId)
              .filter((id): id is string => typeof id === 'string' && id !== ''),
          ),
        ];

        return result;
      },
      { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS },
    );

    await this.announce(sessionId, committedVersion, touchedEntryIds);
    return result;
  }

  /**
   * P7-BE-02 · tell everyone watching, once the change is real.
   *
   * **One hook, twelve commands.** The same argument that put the session lock in
   * `runCommand` rather than in each command file applies exactly: a command cannot
   * forget to emit an event it never emits, and "we forgot to notify" is a bug that
   * only shows up as a screen that quietly stopped updating.
   *
   * Awaited rather than fired and forgotten. It costs one indexed lookup, and it
   * means that by the time a command's HTTP response is written, its events have
   * gone out - which is what makes them testable without polling for them.
   *
   * Never throws: the command has already committed and is correct. A realtime
   * failure downgrades the product from live to stale, and stale is what every
   * client already knows how to recover from.
   */
  private async announce(
    sessionId: string,
    version: number,
    entryIds: string[],
  ): Promise<void> {
    try {
      this.realtime.emitSessionUpdate(sessionId, version);
      if (entryIds.length === 0) return;

      // Only entries with an account behind them: a walk-in registered at the desk
      // has no app and no room to send anything to.
      const owners = await this.prisma.queueEntry.findMany({
        where: { id: { in: entryIds }, accountId: { not: null } },
        select: { id: true, accountId: true },
      });
      for (const owner of owners) {
        if (owner.accountId === null) continue;
        this.realtime.emitEntryUpdate(owner.accountId, owner.id, sessionId, version);
      }
    } catch (error) {
      this.log.error(
        { err: error, sessionId },
        'realtime announce failed - the command committed, clients will refetch',
      );
    }
  }

  /**
   * P6-BE-01 · the roster the doctor and staff consoles render.
   *
   * **A read, so no lock and no command.** It is on this service rather than in
   * `commands/` because it changes nothing: putting it through `runCommand` would
   * take the session lock every time a console re-rendered and serialise reads
   * against the very commands they are watching.
   *
   * Ordered by `CALL_ORDER` - the same comparator `call-next` uses - so the console
   * has no reason to sort and therefore no way to disagree with the engine about who
   * is next (docs/Rules.md 9).
   *
   * `hospitalId` is in the WHERE clause even though `TenantGuard` already resolved it
   * from this session row. Two independent checks, per docs/Rules.md 1.3: a by-id
   * fetch verifies the row belongs to the caller's hospital, always.
   */
  async listEntries(
    sessionId: string,
    hospitalId: string,
    query: SessionQueueQuery,
  ): Promise<Paginated<QueueEntryView>> {
    const where = {
      sessionId,
      hospitalId,
      ...(query.status === undefined ? {} : { status: query.status }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.queueEntry.findMany({
        where,
        orderBy: CALL_ORDER,
        include: ENTRY_INCLUDE,
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.queueEntry.count({ where }),
    ]);

    return { items: rows.map(toEntryView), total, limit: query.limit, offset: query.offset };
  }
}

/**
 * `SELECT ... FOR UPDATE` on the session row.
 *
 * Raw SQL is the documented exception in docs/Rules.md 2: Prisma has no row-lock
 * API, and this lock is the entire concurrency design. Two staff pressing "call
 * next" at the same instant serialise here, so the second sees the first's committed
 * state and gets the NEXT patient rather than the same one.
 *
 * Note there is no `NOWAIT`: blocking is the point.
 */
async function lockSession(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<LockedSession | null> {
  const rows = await tx.$queryRaw<LockedSession[]>`
    SELECT id,
           "hospitalId",
           "departmentId",
           "currentProviderDoctorId",
           status::text            AS status,
           "doctorPresence"::text  AS "doctorPresence",
           "tokenPrefix",
           "feePaise",
           "scheduledStart",
           "scheduledEnd",
           "registrationClosedAt",
           "pausedAt",
           version
    FROM "OPDSession"
    WHERE id = ${sessionId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

/**
 * The queue timeline and the audit trail, written in the same transaction as the
 * mutation they describe.
 *
 * They are separate tables on purpose (see the schema): `QueueEvent` is the queue's
 * own history, read by patients and by the ETA engine; `AuditLog` is the
 * accountability record and also covers actions with no queue at all. Writing both
 * from one call is what stops them drifting apart.
 */
async function writeRecords(
  tx: Prisma.TransactionClient,
  args: {
    session: LockedSession;
    actor: QueueActor;
    command: QueueCommand;
    now: Date;
    reason: string | null;
    records: RecordInput[];
  },
): Promise<void> {
  if (args.records.length === 0) {
    return;
  }

  const { session, actor, command, now, reason } = args;

  await tx.queueEvent.createMany({
    data: args.records.map((r) => ({
      hospitalId: session.hospitalId,
      sessionId: session.id,
      entryId: r.entryId ?? null,
      type: r.type,
      actorType: actor.type,
      actorId: actor.accountId,
      metadata: r.metadata ?? {},
      createdAt: now,
    })),
  });

  await tx.auditLog.createMany({
    data: args.records.map((r) => ({
      hospitalId: session.hospitalId,
      actorType: actor.type,
      actorId: actor.accountId,
      action: `queue.${command}`,
      entityType: r.entryId != null ? 'QueueEntry' : 'OPDSession',
      entityId: r.entryId ?? session.id,
      reason: r.reason ?? reason,
      metadata: r.metadata ?? {},
      createdAt: now,
    })),
  });
}
