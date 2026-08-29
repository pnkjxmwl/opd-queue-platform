import { z } from 'zod';
import { Gender, PatientRelation } from '../enums/patient';

export const Patient = z.object({
  id: z.string().uuid(),
  name: z.string(),
  dob: z.string().datetime().nullable(),
  gender: Gender.nullable(),
  relation: PatientRelation,
  createdAt: z.string().datetime(),
});
export type Patient = z.infer<typeof Patient>;

export const CreatePatientRequest = z.object({
  name: z.string().trim().min(1).max(120),
  /** ISO date. A patient cannot be born tomorrow, so future dates are rejected. */
  dob: z
    .string()
    .datetime()
    .refine((v) => new Date(v) <= new Date(), { message: 'Date of birth cannot be in the future' })
    .optional(),
  gender: Gender.optional(),
  relation: PatientRelation.default('SELF'),
});
export type CreatePatientRequest = z.infer<typeof CreatePatientRequest>;

export const UpdatePatientRequest = CreatePatientRequest.partial();
export type UpdatePatientRequest = z.infer<typeof UpdatePatientRequest>;
