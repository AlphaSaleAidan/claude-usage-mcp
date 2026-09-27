#!/usr/bin/env node
// claude-usage-mcp — lets an AI read its own Claude plan usage (session + weekly %)
// and hold itself to a budget. Zero dependencies. MCP over stdio, or `node server.mjs` for a CLI print.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const BUDGETS = process.env.CLAUDE_USAGE_BUDGETS || join(CLAUDE_DIR, 'usage-budgets.json');
const CACHE_MS = 60_000; // ponytail: 1-min cache so a chatty agent can't hammer the endpoint

function token() {
  if (process.env.CLAUDE_OAUTH_TOKEN) return process.env.CLAUDE_OAUTH_TOKEN;
  let raw;
  const file = join(CLAUDE_DIR, '.credentials.json');
  if (existsSync(file)) raw = readFileSync(file, 'utf8');
  else if (process.platform === 'darwin') {
    raw = execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { encoding: 'utf8' });
  }
  const t = raw && JSON.parse(raw).claudeAiOauth?.accessToken;
  if (!t) throw new Error('No Claude login found. Run `claude` and log in with your Pro/Max account.');
  return t;
}

let cache = { at: 0, data: null };
async function fetchUsage() {
  if (Date.now() - cache.at < CACHE_MS) return cache.data;
  const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: { Authorization: `Bearer ${token()}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'claude-usage-mcp' },
  });
  if (res.status === 401) throw new Error('Login token expired. Run any `claude` command once to refresh it, then retry.');
  if (!res.ok) throw new Error(`Usage endpoint returned ${res.status}`);
  cache = { at: Date.now(), data: await res.json() };
  return cache.data;
}

const until = (iso) => {
  if (!iso) return null;
  const m = Math.max(0, Math.round((new Date(iso) - Date.now()) / 60000));
  return m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

function summarize(u) {
  const out = {
    session_pct: u.five_hour?.utilization ?? null,
    session_resets_in: until(u.five_hour?.resets_at),
    weekly_pct: u.seven_day?.utilization ?? null,
    weekly_resets_in: until(u.seven_day?.resets_at),
    weekly_resets_at: u.seven_day?.resets_at ?? null,
  };
  // Per-model weekly caps (e.g. Opus/Fable) come through `limits` with a scope.
  for (const l of u.limits || []) {
    const name = l.scope?.model?.display_name;
    if (l.group === 'weekly' && name) out[`weekly_${name.toLowerCase()}_pct`] = l.percent;
  }
  return out;
}

// --- budgets: "spend at most N% of the weekly limit on project X" ---
const load = () => (existsSync(BUDGETS) ? JSON.parse(readFileSync(BUDGETS, 'utf8')) : {});
const save = (b) => writeFileSync(BUDGETS, JSON.stringify(b, null, 2));

export function measure(b, s) {
  // Weekly window rolled over since we last looked: bank what was spent, restart from 0.
  if (b.resets_at && s.weekly_resets_at && b.resets_at !== s.weekly_resets_at) {
    b.carried += b.last_pct - b.baseline_pct;
    b.baseline_pct = 0;
  }
  b.last_pct = s.weekly_pct;
  b.resets_at = s.weekly_resets_at;
  const used = +(b.carried + s.weekly_pct - b.baseline_pct).toFixed(1);
  const left = +(b.limit_pct - used).toFixed(1);
  return {
    project: b.name, budget_pct: b.limit_pct, used_pct: used, remaining_pct: left,
    status: left <= 0 ? 'OVER_BUDGET — stop work on this project and tell the user' : left < b.limit_pct * 0.2 ? 'LOW — wrap up' : 'OK',
    weekly_pct_now: s.weekly_pct, started: b.started,
    note: 'Measured as the change in account-wide weekly %, so work in other sessions during this time also counts.',
  };
}

const TOOLS = [
  { name: 'get_usage', description: 'Get your real Claude plan usage right now: session (5-hour) % and weekly % used, per-model weekly caps, and time until each resets. Call this before starting large work and whenever the user asks about usage or limits.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'budget_start', description: 'Start a usage budget for a project, e.g. "spend at most 20% of my weekly on X". Records the current weekly % as the starting point. Restarting an existing name resets it.',
    inputSchema: { type: 'object', required: ['project', 'weekly_pct'], properties: {
      project: { type: 'string', description: 'Project name' },
      weekly_pct: { type: 'number', description: 'Max share of the weekly limit, in percentage points (20 = 20%)' } } } },
  { name: 'budget_check', description: 'Check how much of a project budget is used and left. Call this between major steps of budgeted work; stop when status is OVER_BUDGET. Omit project to list all budgets.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } } } },
  { name: 'budget_end', description: 'Delete a project budget.',
    inputSchema: { type: 'object', required: ['project'], properties: { project: { type: 'string' } } } },
];

async function call(name, a = {}) {
  if (name === 'budget_end') { const b = load(); delete b[a.project]; save(b); return { deleted: a.project }; }
  const s = summarize(await fetchUsage());
  if (name === 'get_usage') return s;
  const all = load();
  if (name === 'budget_start') {
    if (!(a.weekly_pct > 0 && a.weekly_pct <= 100)) throw new Error('weekly_pct must be between 0 and 100');
    all[a.project] = { name: a.project, limit_pct: a.weekly_pct, baseline_pct: s.weekly_pct, carried: 0,
      last_pct: s.weekly_pct, resets_at: s.weekly_resets_at, started: new Date().toISOString() };
    const r = measure(all[a.project], s); save(all); return r;
  }
  if (name === 'budget_check') {
    const names = a.project ? [a.project] : Object.keys(all);
    if (a.project && !all[a.project]) throw new Error(`No budget named "${a.project}". Start one with budget_start.`);
    const r = names.map((n) => measure(all[n], s)); save(all);
    return a.project ? r[0] : r;
  }
  throw new Error(`Unknown tool ${name}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;

// --- CLI: `node server.mjs` (in a terminal) prints usage + budgets ---
if (isMain && process.stdin.isTTY) {
  console.log(JSON.stringify({ usage: await call('get_usage'), budgets: await call('budget_check') }, null, 2));
  process.exit(0);
}

// --- MCP stdio (newline-delimited JSON-RPC) ---
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
if (isMain) createInterface({ input: process.stdin }).on('line', async (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications need no reply
  if (method === 'initialize') return send({ id, result: {
    protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} },
    serverInfo: { name: 'claude-usage', version: '0.1.0' } } });
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'tools/list') return send({ id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    try {
      const r = await call(params.name, params.arguments);
      return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] } });
    } catch (e) {
      return send({ id, result: { isError: true, content: [{ type: 'text', text: e.message }] } });
    }
  }
  send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
});
