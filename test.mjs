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
