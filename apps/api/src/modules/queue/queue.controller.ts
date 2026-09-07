import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  CheckInRequest,
  CompleteConsultationRequest,
  EndSessionRequest,
  NoShowRequest,
  PauseRequest,
  PresenceRequest,
  RequeueRequest,
  ResumeRequest,
  SessionQueueQuery,
  SetPriorityRequest,
  SkipRequest,
  StartConsultationRequest,
  WalkInRequest,
  type ActorType,
  type Paginated,
  type QueueCommandResult,
  type QueueEntryView,
} from '@opd/contracts';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { CurrentAccount, CurrentHospital, Roles } from '../../common/decorators';
import type { AuthedAccount, TenantContext } from '../../common/auth-context';
import { QueueService, type QueueActor } from './queue.service';
import { checkIn } from './commands/check-in';
import { callNext } from './commands/call-next';
import { startConsultation } from './commands/start-consultation';
import { completeConsultation } from './commands/complete-consultation';
import { skip } from './commands/skip';
import { noShow } from './commands/no-show';
import { requeue } from './commands/requeue';
import { pause, resume } from './commands/pause';
import { endSession } from './commands/end-session';
import { presence } from './commands/presence';
import { walkIn } from './commands/walk-in';
import { setPriority } from './commands/priority';

/**
 * The queue's command surface (docs/Architecture.md 6.4).
 *
 * Thin by rule (docs/Rules.md 4): validate with a shared Zod schema, build the
 * actor from the RESOLVED tenant, delegate. There is no logic here and there must
 * never be - every decision belongs to the command and the state machine behind it.
 *
 * **`:sessionId`, not `:id`.** The name is what makes the global TenantGuard resolve
 * the hospital from the session row and reject anyone without an active membership
 * in it. Renaming it to `:id` would silently unscope all twelve endpoints, and
 * patient-facing discovery deliberately keeps `:id` for the opposite reason (trap 12
 * in docs/PROGRESS.md).
 *
 * **Roles.** The class default is every role that can be in a hospital, because a
 * small hospital's admin genuinely does run reception and the desk genuinely does
 * drive the board. Two commands override it: STARTING and COMPLETING a consultation
 * are the clinical record - they assert a doctor saw this patient - and PRD 6.2
 * gives them to the doctor. A method-level @Roles wins over this one (RolesGuard
 * uses getAllAndOverride), so the override is additive and reads locally.
 *
 * ADMIN keeps them deliberately: it is the hospital's own owner account and the only
 * role that can always unstick a clinic. RECEPTION is the one being excluded.
 *
 * The rest stay shared ON PURPOSE. PRD 6.2 lists Call Next, Skip and End Session
 * under the doctor's console, but that section describes what a doctor SEES, not an
 * exclusive grant - 6.3 gives reception "operational fixes" over the same queue, and
 * call-next is already gated on the doctor being present, which is the guarantee
 * that actually matters. Restricting them further would add friction without
 * protecting a record.
 */
@Roles('ADMIN', 'RECEPTION', 'DOCTOR')
@Controller('sessions/:sessionId')
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  /**
   * The one READ on this controller (P6-BE-01). Reads may be resource-style
   * (docs/Rules.md 6); only writes have to be commands.
   */
  @Get('queue')
  listQueue(
    @Param('sessionId') sessionId: string,
    @CurrentHospital() tenant: TenantContext,
    @Query(new ZodBody(SessionQueueQuery)) query: SessionQueueQuery,
  ): Promise<Paginated<QueueEntryView>> {
    return this.queue.listEntries(sessionId, tenant.hospitalId, query);
  }

  @Post('check-in')
  checkIn(
    @Param('sessionId') sessionId: string,
    @CurrentAccount() account: AuthedAccount,
    @CurrentHospital() tenant: TenantContext,
    @Body(new ZodBody(CheckInRequest)) body: CheckInRequest,
  ): Promise<QueueCommandResult> {
    return checkIn(this.queue, sessionId, actorOf(account, tenant), body);
  }

  @Post('call-next')
  callNext(
    @Param('sessionId') sessionId: string,
    @CurrentAccount() account: AuthedAccount,
    @CurrentHospital() tenant: TenantContext,
  ): Promise<QueueCommandResult> {
    return callNext(this.queue, sessionId, actorOf(account, tenant));
  }

  @Roles('ADMIN', 'DOCTOR')
  @Post('start-consultation')
  startConsultation(
    @Param('sessionId') sessionId: string,
    @CurrentAccount() account: AuthedAccount,
    @CurrentHospital() tenant: TenantContext,
    @Body(new ZodBody(StartConsultationRequest)) body: StartConsultationRequest,
  ): Promise<QueueCommandResult> {
    return startConsultation(this.queue, sessionId, actorOf(account, tenant), body);
  }

  @Roles('ADMIN', 'DOCTOR')
  @Post('complete-consultation')
  completeConsultation(
    @Param('sessionId') sessionId: string,
    @CurrentAccount() account: AuthedAccount,
    @CurrentHospital() tenant: TenantContext,
    @Body(new ZodBody(CompleteConsultationRequest)) body: CompleteConsultationRequest,
  ): Promise<QueueCommandResult> {
    return completeConsultation(this.queue, sessionId, actorOf(account, tenant), body);
  }

  @Post('skip')
  skip(
    @Param('sessionId') sessionId: string,
    @CurrentAccount() account: AuthedAccount,
    @CurrentHospital() tenant: TenantContext,
    @Body(new ZodBody(SkipRequest)) body: SkipRequest,
  ): Promise<QueueCommandResult> {
    return skip(this.queue, sessionId, actorOf(account, tenant), body);
  }

  @Post('no-show')
  noShow(
    @Param('sessionId') sessionId: string,
    @CurrentAccount() account: AuthedAccount,
    @CurrentHospital() tenant: TenantContext,
    @Body(new ZodBody(NoShowRequest)) body: NoShowRequest,
  ): Promise<QueueCommandResult> {
    return noShow(this.queue, sessionId, actorOf(account, tenant), body);
  }

  @Post('requeue')
  requeue(
    @Param('sessionId') sessionId: string,
    @CurrentAccount() account: AuthedAccount,
    @CurrentHospital() tenant: TenantContext,
    @Body(new ZodBody(RequeueRequest)) body: RequeueRequest,
  ): Promise<QueueCommandResult> {
    return requeue(this.queue, sessionId, actorOf(account, tenant), body);
  }

  @Post('pause')
  pause(
    @Param('sessionId') sessionId: string,
    @CurrentAccount() account: AuthedAccount,
    @CurrentHospital() tenant: TenantContext,
    @Body(new ZodBody(PauseRequest)) body: PauseRequest,
  ): Promise<QueueCommandResult> {
    return pause(this.queue, sessionId, actorOf(account, tenant), body);
  }

  @Post('resume')
  resume(
    @Param('sessionId') sessionId: string,
    @CurrentAccount() account: AuthedAccount,
    @CurrentHospital() tenant: TenantContext,
    @Body(new ZodBody(ResumeRequest)) body: ResumeRequest,
  ): Promise<QueueCommandResult> {
    return resume(this.queue, sessionId, actorOf(account, tenant), body);
  }

  @Post('end')
  end(
    @Param('sessionId') sessionId: string,
    @CurrentAccount() account: AuthedAccount,
    @CurrentHospital() tenant: TenantContext,
    @Body(new ZodBody(EndSessionRequest)) body: EndSessionRequest,
  ): Promise<QueueCommandResult> {
    return endSession(this.queue, sessionId, actorOf(account, tenant), body);
  }

  @Post('presence')
  presence(
    @Param('sessionId') sessionId: string,
    @CurrentAccount() account: AuthedAccount,
    @CurrentHospital() tenant: TenantContext,
    @Body(new ZodBody(PresenceRequest)) body: PresenceRequest,
  ): Promise<QueueCommandResult> {
    return presence(this.queue, sessionId, actorOf(account, tenant), body);
  }

  @Post('walk-in')
  walkIn(
    @Param('sessionId') sessionId: string,
    @CurrentAccount() account: AuthedAccount,
    @CurrentHospital() tenant: TenantContext,
    @Body(new ZodBody(WalkInRequest)) body: WalkInRequest,
  ): Promise<QueueCommandResult> {
    return walkIn(this.queue, sessionId, actorOf(account, tenant), body);
  }

  @Post('priority')
  priority(
    @Param('sessionId') sessionId: string,
    @CurrentAccount() account: AuthedAccount,
    @CurrentHospital() tenant: TenantContext,
    @Body(new ZodBody(SetPriorityRequest)) body: SetPriorityRequest,
  ): Promise<QueueCommandResult> {
    return setPriority(this.queue, sessionId, actorOf(account, tenant), body);
  }
}

/**
 * The actor, built entirely from server-resolved values.
 *
 * `hospitalId` comes from TenantGuard's membership lookup and never from the
 * request. A DOCTOR membership is recorded as a DOCTOR on the timeline; ADMIN and
 * RECEPTION both act as STAFF, because on the audit trail the meaningful
 * distinction is "the clinician" versus "the desk", and the exact membership role is
 * already recoverable from HospitalStaff.
 */
const ACTOR_TYPE: Record<TenantContext['role'], ActorType> = {
  DOCTOR: 'DOCTOR',
  ADMIN: 'STAFF',
  RECEPTION: 'STAFF',
};

const actorOf = (account: AuthedAccount, tenant: TenantContext): QueueActor => ({
  accountId: account.id,
  hospitalId: tenant.hospitalId,
  type: ACTOR_TYPE[tenant.role],
});
