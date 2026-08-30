import { z } from 'zod';

/**
 * docs/Rules.md 6: list endpoints paginate. Never return an unbounded list.
 *
 * Offset-based, because the admin console shows numbered pages over small,
 * frequently-edited config lists and wants a total. Patient-facing discovery
 * (Phase 3) scrolls instead and may want a cursor - it can add one then; the two
 * styles can coexist because they serve different screens.
 *
 * `coerce` because query strings arrive as strings.
 */
export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PageQuery = z.infer<typeof PageQuery>;

export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  });

export type Paginated<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};
