import assert from 'node:assert';
import { measure } from './server.mjs';
const b = { name: 'x', limit_pct: 20, baseline_pct: 30, carried: 0, last_pct: 30, resets_at: 'W1' };
assert.equal(measure(b, { weekly_pct: 42, weekly_resets_at: 'W1' }).used_pct, 12);
assert.equal(measure(b, { weekly_pct: 45, weekly_resets_at: 'W1' }).status, 'OK');
// week rolls over: 15 banked from old week + 6 in the new one = 21 -> over
const r = measure(b, { weekly_pct: 6, weekly_resets_at: 'W2' });
assert.equal(r.used_pct, 21); assert.match(r.status, /^OVER_BUDGET/);
assert.match(measure(b, { weekly_pct: 3, weekly_resets_at: 'W2' }).status, /^LOW|^OK/);
console.log('ok');

// 11-09 bug: the reset time jitters by fractions of a second; that is not a new week (was: 114% used of a 3% budget, 0 real use).
const j = { name: 'j', limit_pct: 3, baseline_pct: 40, carried: 0, last_pct: 40, resets_at: '2026-11-15T10:00:00.157576+00:00' };
for (const t of ['00.633040', '00.912311', '01.004000'])
  assert.equal(measure(j, { weekly_pct: 40, weekly_resets_at: `2026-11-15T10:00:${t}+00:00` }).used_pct, 0);
// a real reset (a week later) still banks the old week
assert.equal(measure(j, { weekly_pct: 1, weekly_resets_at: '2026-11-22T10:00:00.5+00:00' }).used_pct, 1);
// a Fable budget tracks weekly_fable_pct, not the whole weekly
const fb = { name: 'f', model: 'fable', limit_pct: 90, baseline_pct: 0, carried: 0, last_pct: 0, resets_at: 'W1' };
const fr = measure(fb, { weekly_pct: 55, weekly_fable_pct: 12, weekly_resets_at: 'W1' });
assert.equal(fr.used_pct, 12); assert.equal(fr.model, 'fable');
console.log('ok jitter + fable');
