'use server';

import { cookies } from 'next/headers';
import type { StaffInvite } from '@opd/contracts';
import { apiSend } from '../../../../lib/api';
import { INVITE_COOKIE, INVITE_COOKIE_TTL_SEC, num, runAction, text } from '../_run';

const PATH = '/config/doctors';

export async function createDoctor(form: FormData): Promise<void> {
  const specialization = text(form, 'specialization');

  await runAction(PATH, (hospitalId) =>
    apiSend('POST', `/hospitals/${hospitalId}/doctors`, {
      departmentId: text(form, 'departmentId'),
      name: text(form, 'name'),
      // Omitted, not empty-string: the contract wants it absent when unset.
      ...(specialization ? { specialization } : {}),
      defaultConsultMins: num(form, 'defaultConsultMins') ?? 10,
    }),
  );
}

export async function updateDoctor(form: FormData): Promise<void> {
  const id = text(form, 'id');
  const specialization = text(form, 'specialization');

  await runAction(PATH, (hospitalId) =>
    apiSend('PATCH', `/hospitals/${hospitalId}/doctors/${id}`, {
      departmentId: text(form, 'departmentId'),
      name: text(form, 'name'),
      specialization: specialization || undefined,
      defaultConsultMins: num(form, 'defaultConsultMins') ?? undefined,
    }),
  );
}

export async function setDoctorActive(form: FormData): Promise<void> {
  const id = text(form, 'id');
  const activate = text(form, 'activate') === 'true';

  await runAction(PATH, (hospitalId) =>
    activate
      ? apiSend('PATCH', `/hospitals/${hospitalId}/doctors/${id}`, { isActive: true })
      : apiSend('DELETE', `/hospitals/${hospitalId}/doctors/${id}`),
  );
}

/**
 * Invite a doctor and hand the admin the resulting link.
 *
 * MVP has no email channel, so the invitation is delivered by the admin passing the
 * link on. The API returns the token exactly once - only its hash is stored - which
 * is why it is captured here rather than fetched again later.
 */
export async function inviteDoctorLogin(form: FormData): Promise<void> {
  await runAction(PATH, async (hospitalId) => {
    const invite = await apiSend<StaffInvite>('POST', `/hospitals/${hospitalId}/staff`, {
      email: text(form, 'email'),
      role: 'DOCTOR',
      doctorId: text(form, 'doctorId'),
    });

    (await cookies()).set(
      INVITE_COOKIE,
      JSON.stringify({
        email: invite.email,
        token: invite.inviteToken,
        expiresAt: invite.inviteExpiresAt,
      }),
      {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: PATH,
        maxAge: INVITE_COOKIE_TTL_SEC,
      },
    );
  });
}
