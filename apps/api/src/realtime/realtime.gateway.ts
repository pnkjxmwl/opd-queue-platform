import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import {
  REALTIME_EVENT,
  SubscribeRequest,
  accountRoom,
  sessionRoom,
  type SubscribeAck,
} from '@opd/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { env } from '../config/env';
import type { AccessTokenClaims } from '../common/auth-context';

/**
 * P7-BE-01 · the Socket.IO gateway (docs/Architecture.md 9).
 *
 * **Realtime is a distribution mechanism, never a source of truth** (docs/Rules.md 8).
 * Nothing here reads or writes queue state, and no client can cause a change through
 * it - the only message it accepts asks to *listen* to something. Every write in the
 * product still goes through a REST domain command, so the gateway can be switched
 * off entirely and the product degrades from live to stale, never to broken.
 *
 * **Authorisation happens here, server-side, from the JWT** - never from anything the
 * client sends. A socket is authenticated once at connect and immediately joined to
 * its own account room; it can never ask for somebody else's.
 */
@Injectable()
@WebSocketGateway({
  // Same origin policy as the REST API: the console and the Expo app are separate
  // origins, and a socket that silently fails CORS looks exactly like a socket that
  // is merely quiet.
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection {
  private readonly log = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private readonly server?: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Authenticate, then join the caller to their own private room.
   *
   * The token comes from the handshake `auth` payload rather than a query string:
   * query strings end up in access logs and proxy logs, and this one is a bearer
   * credential.
   *
   * A socket that fails to authenticate is disconnected rather than left connected
   * and mute. A client that thinks it is subscribed but is not is worse than one
   * that knows it is offline - the first shows stale data confidently.
   */
  async handleConnection(socket: Socket): Promise<void> {
    const token =
      typeof socket.handshake.auth?.token === 'string'
        ? socket.handshake.auth.token
        : extractBearer(socket.handshake.headers.authorization);

    if (token === null) {
      socket.disconnect(true);
      return;
    }

    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: env().JWT_ACCESS_SECRET,
      });
      socket.data.accountId = claims.sub;
      await socket.join(accountRoom(claims.sub));
    } catch {
      // Expired, tampered, or signed with the refresh secret - all the same answer.
      socket.disconnect(true);
    }
  }

  /**
   * Join a session's live room.
   *
   * The room carries only what `GET /sessions/:id` already returns to any signed-in
   * patient, so the authorisation question is exactly "may this account read this
   * session?" - and the answer is the same one discovery gives: it must exist, its
   * hospital must be verified, and it must not be cancelled. An unknown id and a
   * hidden one are refused identically, so this cannot be used to discover which
   * session ids exist.
   */
  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<SubscribeAck> {
    const accountId: unknown = socket.data.accountId;
    if (typeof accountId !== 'string') {
      // Belt and braces: handleConnection disconnects an unauthenticated socket, so
      // this is unreachable unless that changes. It is here so that if it ever does,
      // the failure is a refusal rather than an open subscription.
      return { ok: false, error: 'Not signed in' };
    }

    const parsed = SubscribeRequest.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'Unknown session' };

    const visible = await this.prisma.oPDSession.findFirst({
      where: {
        id: parsed.data.sessionId,
        status: { not: 'CANCELLED' },
        hospital: { status: 'VERIFIED' },
      },
      select: { id: true },
    });
    if (visible === null) return { ok: false, error: 'Unknown session' };

    await socket.join(sessionRoom(parsed.data.sessionId));
    return { ok: true };
  }

  /** Leaving is unconditional - a client may always stop listening. */
  @SubscribeMessage('unsubscribe')
  async unsubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<SubscribeAck> {
    const parsed = SubscribeRequest.safeParse(body);
    if (parsed.success) await socket.leave(sessionRoom(parsed.data.sessionId));
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Emitting. The only surface other modules touch.
  // -------------------------------------------------------------------------

  /**
   * "This queue moved."
   *
   * **Called only after a transaction has committed** (see `QueueService.runCommand`).
   * An event emitted inside a transaction that then rolls back is a ghost update: the
   * patient is told they were called and the database disagrees.
   *
   * Never throws. A realtime failure must not fail the command that already
   * succeeded - the queue is correct, and the clients will pick it up on their next
   * read. That is the difference between a degraded feature and a broken one.
   */
  emitSessionUpdate(sessionId: string, version: number): void {
    this.safely(() => {
      this.server?.to(sessionRoom(sessionId)).emit(REALTIME_EVENT.sessionUpdated, {
        sessionId,
        version,
      });
    });
  }

  /** "Something about your booking changed." Only to the account that owns it. */
  emitEntryUpdate(accountId: string, entryId: string, sessionId: string, version: number): void {
    this.safely(() => {
      this.server?.to(accountRoom(accountId)).emit(REALTIME_EVENT.entryUpdated, {
        entryId,
        sessionId,
        version,
      });
    });
  }

  /**
   * `server` is undefined until the gateway is attached, which is the case in unit
   * tests and would be the case behind a kill switch. Emitting is then a no-op, and
   * that is the whole feature-flag story docs/Phases.md asks for: *"the gateway can
   * be feature-flagged off and every REST path still works."*
   */
  private safely(emit: () => void): void {
    try {
      emit();
    } catch (error) {
      this.log.error({ err: error }, 'realtime emit failed - state is committed, clients will refetch');
    }
  }
}

const extractBearer = (header: string | undefined): string | null =>
  header?.startsWith('Bearer ') === true ? header.slice(7) : null;
