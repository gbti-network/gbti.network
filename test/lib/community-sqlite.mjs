// sow-494: a real SQLite engine for the Community store tests, through Node 22's built-in node:sqlite. Production runs
// the same store over a Durable Object's ctx.storage.sql; both speak the store's adapter, `exec(query, ...bindings)`
// returning row objects. Using a real engine, not a fake, is the point: the store's rules are SQL, and a fake would
// test the fake.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { CommunityStore } from '../../membership/community-store.mjs';

export function sqliteAdapter() {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    exec(query, ...bindings) {
      const stmt = db.prepare(query);
      return stmt.all(...bindings).map((row) => ({ ...row }));
    },
  };
}

/** A store on a fresh in-memory database, with a controllable clock and deterministic ids. */
export function makeStore({ start = Date.UTC(2026, 10, 7, 17, 0, 0) } = {}) {
  let t = start;
  let seq = 0;
  const randomBytes = (n) => {
    seq += 1;
    return new Uint8Array(createHash('sha256').update(`id-${seq}`).digest()).slice(0, n);
  };
  const store = new CommunityStore(sqliteAdapter(), { now: () => t, randomBytes });
  return { store, advance: (ms) => { t += ms; }, now: () => t };
}

export const SUPER = { githubId: '125175036', login: 'gbtilabs', superadmin: true };
export const member = (n, login = `member${n}`) => ({ githubId: String(1000 + n), login, superadmin: false });
export const PRIYA = { githubId: '2001', login: 'priya', superadmin: false };
export const BEN = { githubId: '2002', login: 'ben', superadmin: false };

/** A tiny valid image of each kind, as bytes. */
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
export const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1]);
export const toB64 = (bytes) => Buffer.from(bytes).toString('base64');
