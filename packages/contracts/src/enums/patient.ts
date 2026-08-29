import { z } from 'zod';

export const Gender = z.enum(['MALE', 'FEMALE', 'OTHER']);
export type Gender = z.infer<typeof Gender>;

/** Who this patient profile is, relative to the account holder. */
export const PatientRelation = z.enum([
  'SELF',
  'SPOUSE',
  'MOTHER',
  'FATHER',
  'CHILD',
  'SIBLING',
  'OTHER',
]);
export type PatientRelation = z.infer<typeof PatientRelation>;
