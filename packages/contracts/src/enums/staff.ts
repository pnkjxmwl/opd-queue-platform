import { z } from 'zod';

/** A staff member's role within one hospital. Authority comes from the membership, not the account. */
export const Role = z.enum(['ADMIN', 'RECEPTION', 'DOCTOR']);
export type Role = z.infer<typeof Role>;

export const StaffStatus = z.enum(['ACTIVE', 'INVITED', 'DISABLED']);
export type StaffStatus = z.infer<typeof StaffStatus>;
