import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { StaffService } from './modules/staff/staff.service';
import { QueuePolicyService } from './modules/config/queue-policy.service';

/**
 * Onboard one hospital, and invite its first administrator.
 *
 * **This is the bootstrap nothing else can do.** Every hospital-scoped route is
 * `hospitals/:hospitalId/...` and assumes the hospital already exists; `StaffService`
 * requires an existing ADMIN in the hospital before it will invite anyone; and
 * `Role` is `ADMIN | RECEPTION | DOCTOR` with no platform-level role above it. So the
 * first three rows for a new tenant - the hospital, its queue policy, and one ADMIN
 * membership - had no way to come into existence except the development seed or
 * hand-written SQL against a live database. This is that path, made repeatable.
 *
 * docs/PRD.md 14 always said the first hospitals are onboarded manually
 * ("white-glove") and 6.5 leaves a super-admin console out of the MVP. What was never
 * decided is whether "manually" means a command or a person typing INSERT at eleven
 * at night. It means this.
 *
 * ## Why it boots the real application
 *
 * `createApplicationContext` gives it the actual `StaffService`, so the invitation is
 * created by the same code the console calls: one 32-byte token, SHA-256 stored, the
 * plaintext returned exactly once, and the account created with **no password** so
 * the administrator sets their own through `/accept-invite`. Reimplementing that here
 * would duplicate the security-sensitive half of the invite scheme in a file nobody
 * tests - and this codebase has already been bitten once by copied logic drifting
 * from the original (the two workers that copied the sweep loop and silently lost
 * their kill switch).
 *
 * The cost is that it starts Redis and the background sweepers for the second or two
 * the script runs. They are `unref`'d and torn down on close, and this does nothing a
 * running API would not.
 *
 * ## What it deliberately does NOT do
 *
 * It does not hand out a password. An invitation is not a credential: the token is
 * single-use, expires in seven days, and the administrator chooses their own
 * password. Nothing here ever learns it.
 *
 * It does not refuse to run in production - unlike `seed.ts`, which must never touch
 * real data. **This script exists to run against production**, so its guards are
 * about not duplicating a tenant rather than about which environment it is in.
 *
 * ## Usage
 *
 * ```
 * pnpm --filter @opd/api onboard -- \
 *   --name "Apollo Clinic" --city Mumbai --admin admin@apollo.test
 * ```
 */

/** CLI output. `process.stdout` rather than console, which eslint reserves for warn/error. */
const say = (line = ''): void => void process.stdout.write(`${line}\n`);

interface Options {
  name: string;
  city: string;
  area: string | null;
  address: string | null;
  admin: string;
  consoleUrl: string;
}

const USAGE = `
Onboard a hospital and invite its first administrator.

  --name         Hospital name                            (required)
  --city         City, as patients will search for it     (required)
  --admin        Email of the first administrator         (required)
  --area         Neighbourhood, shown on discovery cards  (optional)
  --address      Street address                           (optional)
  --console-url  Where the invite link should point       (default http://localhost:3001)

Example:
  pnpm --filter @opd/api onboard -- --name "Apollo Clinic" --city Mumbai --admin admin@apollo.test
`;

function readOptions(): Options {
  // `pnpm run onboard -- --name X` forwards the separator itself, and parseArgs
  // treats a leading `--` as "everything after this is positional" - which with
  // `allowPositionals: false` rejects every flag. Dropping only a LEADING one keeps
  // the guard intact for anything that really is a positional argument.
  const argv = process.argv.slice(2);
  const args = argv[0] === '--' ? argv.slice(1) : argv;

  const { values } = parseArgs({
    args,
    options: {
      name: { type: 'string' },
      city: { type: 'string' },
      area: { type: 'string' },
      address: { type: 'string' },
      admin: { type: 'string' },
      'console-url': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  });

  if (values.help === true) {
    say(USAGE);
    process.exit(0);
  }

  const missing = (['name', 'city', 'admin'] as const).filter(
    (key) => (values[key] ?? '').trim() === '',
  );
  if (missing.length > 0) {
    throw new Error(`missing required option(s): ${missing.map((m) => `--${m}`).join(', ')}\n${USAGE}`);
  }

  const admin = values.admin!.trim().toLowerCase();
  // Deliberately loose. The real validation is that a person receives the invitation
  // at this address; a regex that rejects a valid address is worse than one that
  // accepts a typo, because the typo is visible in the output below.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(admin)) {
    throw new Error(`--admin does not look like an email address: ${admin}`);
  }

  const trimmed = (value: string | undefined): string | null => {
    const out = (value ?? '').trim();
    return out === '' ? null : out;
  };

  return {
    name: values.name!.trim(),
    city: values.city!.trim(),
    area: trimmed(values.area),
    address: trimmed(values.address),
    admin,
    consoleUrl: (values['console-url'] ?? 'http://localhost:3001').replace(/\/+$/, ''),
  };
}

async function main(): Promise<void> {
  const options = readOptions();

  // `logger: false`: this is a CLI and its output is the point. Nest's boot banner
  // would bury the invitation link under provider initialisation noise.
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const prisma = app.get(PrismaService);
    const staff = app.get(StaffService);
    const policies = app.get(QueuePolicyService);

    // One hospital per name+city. Not a database constraint, because two genuinely
    // different clinics may share a name in different cities and a chain may
    // legitimately want "Apollo Clinic" twice in one city later - so this is a guard
    // against the accident (running the script twice), not a rule about the domain.
    const clash = await prisma.hospital.findFirst({
      where: { name: options.name, city: options.city },
      select: { id: true, status: true },
    });
    if (clash !== null) {
      throw new Error(
        `"${options.name}" already exists in ${options.city} (id ${clash.id}, status ${clash.status}).\n` +
          'To add another administrator to it, use the console: Configuration -> Staff -> Invite.',
      );
    }

    const hospital = await prisma.hospital.create({
      data: {
        name: options.name,
        city: options.city,
        area: options.area,
        address: options.address,
        // VERIFIED, not PENDING. Running this command IS the verification step - a
        // human decided to onboard this hospital. PENDING would create a tenant that
        // no patient can see and nothing in the product can promote, which is the
        // hole this script exists to close rather than reproduce.
        status: 'VERIFIED',
      },
      select: { id: true, name: true, city: true },
    });

    // The queue engine must never meet a hospital without a policy - every command
    // reads one. Through the owning service, so the defaults live in exactly one
    // place (`DEFAULT_QUEUE_POLICY` in contracts) rather than being restated here.
    await policies.ensure(hospital.id);

    // The real invite path: creates the Account with no password, the membership as
    // INVITED, and returns the plaintext token exactly once.
    const invite = await staff.invite(hospital.id, { email: options.admin, role: 'ADMIN' });

    const link = `${options.consoleUrl}/accept-invite?token=${invite.inviteToken}`;

    say();
    say(`  Hospital   ${hospital.name} — ${hospital.city}`);
    say(`  Id         ${hospital.id}`);
    say(`  Status     VERIFIED (listable to patients)`);
    say(`  Policy     created with platform defaults`);
    say(`  Admin      ${invite.email} (invited, expires ${new Date(invite.inviteExpiresAt).toDateString()})`);
    say();
    say('  Send them this link. It works once and is not recoverable — if it is lost,');
    say('  re-invite from the console rather than re-running this command.');
    say();
    say(`  ${link}`);
    say();
    say('  They set their own password on that page; nothing here ever knows it.');
    say('  After signing in they can add departments, doctors, schedules and sessions,');
    say('  and invite the rest of the staff themselves.');
    say();
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    process.stderr.write(`\n  ${error instanceof Error ? error.message : String(error)}\n\n`);
    process.exit(1);
  });
