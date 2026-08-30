/**
 * @opd/contracts - the single source of truth for API shapes and enums.
 *
 * docs/Rules.md 6: define the Zod schema here and infer the type from it. Never
 * re-type an API shape inside an app.
 */
export * from './common/error';
export * from './common/health';
export * from './common/pagination';
export * from './enums/queue';
export * from './enums/staff';
export * from './enums/patient';
export * from './enums/config';
export * from './auth/dto';
export * from './patients/dto';
export * from './config/dto';
export * from './discovery/dto';
