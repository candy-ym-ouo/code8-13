// Dev-only verification: run every Prisma migration inside PGlite (in-memory
// PostgreSQL) and assert the location/copy invariants in raw SQL.
// Not part of the vitest suite because it needs the migration files on disk.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'prisma', 'migrations');

const migrationNames = [
  '202609240001_init',
  '202609270001_extend_audit_enums',
  '202609270002_shelf_locations_and_copies'
];

const db = new PGlite();

for (const name of migrationNames) {
  const sql = await readFile(path.join(migrationsDir, name, 'migration.sql'), 'utf8');
  // ALTER TYPE ... ADD VALUE cannot run in the same implicit transaction as
  // statements that use the new values; PGlite executes each exec() autocommitted.
  await db.exec(sql);
  console.log(`migration applied: ${name}`);
}

async function one<T>(query: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<Record<string, unknown>>(query, params);
  return result.rows[0] as T;
}

// Seed user and book (updated_at is maintained by Prisma, not by a DB default).
const now = () => new Date().toISOString();
const user = await one<{ id: string }>(
  `INSERT INTO users (id, email, password_hash, updated_at) VALUES (gen_random_uuid(), 'a@b.c', 'x', $1) RETURNING id`,
  [now()]
);
const book = await one<{ id: string }>(
  `INSERT INTO books (id, user_id, title, updated_at) VALUES (gen_random_uuid(), $1, '同一本书', $2) RETURNING id`,
  [user.id, now()]
);

const shelfA = await one<{ id: string }>(
  `INSERT INTO shelf_locations (id, user_id, name, updated_at) VALUES (gen_random_uuid(), $1, '客厅书柜', $2) RETURNING id`,
  [user.id, now()]
);
const shelfB = await one<{ id: string }>(
  `INSERT INTO shelf_locations (id, user_id, name, updated_at) VALUES (gen_random_uuid(), $1, '卧室床头', $2) RETURNING id`,
  [user.id, now()]
);

// Two copies of the SAME book.
const copy1 = await one<{ id: string }>(
  `INSERT INTO book_copies (id, user_id, book_id, copy_number, current_location_id, updated_at)
   VALUES (gen_random_uuid(), $1, $2, 1, $3, $4) RETURNING id`,
  [user.id, book.id, shelfA.id, now()]
);
const copy2 = await one<{ id: string }>(
  `INSERT INTO book_copies (id, user_id, book_id, copy_number, current_location_id, updated_at)
   VALUES (gen_random_uuid(), $1, $2, 2, $3, $4) RETURNING id`,
  [user.id, book.id, shelfA.id, now()]
);

// Audit: copy #1 moves A -> B.
await db.query(
  `INSERT INTO copy_location_events (id, user_id, copy_id, book_id, action, from_location_id, to_location_id, from_snapshot, to_snapshot)
   VALUES (gen_random_uuid(), $1, $2, $3, 'MOVED', $4, $5, '客厅书柜', '卧室床头')`,
  [user.id, copy1.id, book.id, shelfA.id, shelfB.id]
);
await db.query(
  `UPDATE book_copies SET current_location_id = $1 WHERE id = $2`,
  [shelfB.id, copy1.id]
);

// Soft-delete copy #1: it must leave its shelf, while copy #2 stays on shelf A.
await db.query(
  `UPDATE book_copies SET deleted_at = now(), current_location_id = NULL, status = 'ARCHIVED', version = version + 1 WHERE id = $1`,
  [copy1.id]
);

const remaining = await one<{ locationId: string | null; copyNumber: number }>(
  `SELECT current_location_id AS "locationId", copy_number AS "copyNumber" FROM book_copies WHERE id = $1`,
  [copy2.id]
);
if (remaining.locationId !== shelfA.id) throw new Error('other copy lost its location');
if (remaining.copyNumber !== 2) throw new Error('other copy number changed');
console.log('OK: deleting one copy does not affect the other copy');

// copy_number stays unique per book (re-registering must not reuse a number).
await db.query(
  `INSERT INTO book_copies (id, user_id, book_id, copy_number, updated_at) VALUES (gen_random_uuid(), $1, $2, 3, $3)`,
  [user.id, book.id, now()]
);
const reused = await db.query(
  `INSERT INTO book_copies (id, user_id, book_id, copy_number, updated_at) VALUES (gen_random_uuid(), $1, $2, 1, $3)`,
  [user.id, book.id, now()]
).catch((error: unknown) => error);
if (!(reused instanceof Error)) throw new Error('duplicate copy_number was accepted');
console.log('OK: copy numbers are unique per book');

// History remains readable after deletion; archived location blocks new placement
// only at application level, but its row survives for the snapshot FKs.
const historyCount = await one<{ count: string }>(
  `SELECT count(*)::text AS count FROM copy_location_events WHERE copy_id = $1`,
  [copy1.id]
);
if (Number(historyCount.count) !== 1) throw new Error('migration history was lost');
console.log('OK: migration history retained for a deleted copy');

// Location name uniqueness per user.
const dupName = await db.query(
  `INSERT INTO shelf_locations (id, user_id, name, updated_at) VALUES (gen_random_uuid(), $1, '客厅书柜', $2)`,
  [user.id, now()]
).catch((error: unknown) => error);
if (!(dupName instanceof Error)) throw new Error('duplicate location name was accepted');
console.log('OK: location names are unique per user');

// Audit enum values exist and are usable.
await db.query(
  `INSERT INTO activity_events (id, user_id, book_id, entity_type, entity_id, action, payload_json)
   VALUES (gen_random_uuid(), $1, $2, 'BOOK_COPY', $3, 'MOVED', '{}')`,
  [user.id, book.id, copy1.id]
);
await db.query(
  `INSERT INTO activity_events (id, user_id, entity_type, entity_id, action, payload_json)
   VALUES (gen_random_uuid(), $1, 'SHELF_LOCATION', $2, 'ARCHIVED', '{}')`,
  [user.id, shelfA.id]
);
console.log('OK: new audit enum values are accepted');

// Restrict FK: deleting a location that is referenced is rejected at the DB level.
const restrict = await db.query(`DELETE FROM shelf_locations WHERE id = $1`, [shelfA.id]).catch(
  (error: unknown) => error
);
if (!(restrict instanceof Error)) throw new Error('restrict FK did not fire for location delete');
console.log('OK: referenced locations cannot be hard-deleted (RESTRICT)');

console.log('\nAll migration/invariant checks passed.');
await db.close();
