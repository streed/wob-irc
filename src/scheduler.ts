import Database from 'better-sqlite3';

export type JobMode = 'tool' | 'prompt';

export type ScheduleKind = 'interval' | 'daily' | 'weekly' | 'cron';

export interface ScheduleSpec {
  kind: ScheduleKind;
  // interval minutes for kind = interval
  intervalMinutes?: number;
  // time of day for kind = daily or weekly
  timeOfDay?: { hour: number; minute: number };
  // day of week for kind = weekly (0=Sunday..6=Saturday)
  dayOfWeek?: number;
  // cron expression for kind=cron (5 fields: m h dom mon dow)
  cronExpr?: string;
}

export interface CreateJobOptions {
  channel: string;
  actorNick?: string;
  mode: JobMode;
  // For mode = 'tool'
  toolName?: string;
  parameters?: Record<string, any>;
  // For mode = 'prompt'
  commandText?: string;
  // Human-readable schedule string (e.g., "every hour", "every day at 5pm")
  scheduleText?: string;
  // Or structured schedule
  scheduleSpec?: ScheduleSpec;
}

export interface ScheduledJobRow {
  id: number;
  channel: string;
  actor_nick: string | null;
  mode: JobMode;
  tool_name: string | null;
  parameters_json: string | null;
  command_text: string | null;
  schedule_type: string;
  schedule_spec_json: string;
  next_run: number;
  last_run: number | null;
  active: number;
  created_at: number;
  updated_at: number;
}

type ExecuteToolFn = (toolName: string, parameters: Record<string, any>, runtime: { channel: string; actorNick?: string }) => Promise<string>;
type SendMessageFn = (channel: string, message: string) => Promise<void>;
type SubmitPromptFn = (channel: string, actorNick: string | undefined, text: string) => Promise<void>;

export class Scheduler {
  private db: Database.Database;
  private tickTimer?: NodeJS.Timeout;
  private executeTool: ExecuteToolFn;
  private sendMessage: SendMessageFn;
  private submitPrompt: SubmitPromptFn;
  private tickIntervalMs: number;

  constructor(
    dbPath: string,
    opts: {
      executeTool: ExecuteToolFn;
      sendMessage: SendMessageFn;
      submitPrompt: SubmitPromptFn;
      tickIntervalMs?: number;
    }
  ) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.executeTool = opts.executeTool;
    this.sendMessage = opts.sendMessage;
    this.submitPrompt = opts.submitPrompt;
    this.tickIntervalMs = opts.tickIntervalMs ?? 30_000; // 30s default

    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        actor_nick TEXT,
        mode TEXT NOT NULL,
        tool_name TEXT,
        parameters_json TEXT,
        command_text TEXT,
        schedule_type TEXT NOT NULL,
        schedule_spec_json TEXT NOT NULL,
        next_run INTEGER NOT NULL,
        last_run INTEGER,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_next_run ON scheduled_jobs(active, next_run);
      CREATE INDEX IF NOT EXISTS idx_jobs_channel ON scheduled_jobs(channel);
    `);
  }

  start(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => {
      this.processDueJobs().catch(err => console.error('[scheduler] tick error:', err));
    }, this.tickIntervalMs);
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = undefined;
  }

  close(): void {
    this.stop();
    try { this.db.close(); } catch (_) {}
  }

  async processDueJobs(): Promise<void> {
    const now = Date.now();
    const rows = this.db
      .prepare(`SELECT * FROM scheduled_jobs WHERE active = 1 AND next_run <= ? ORDER BY next_run ASC LIMIT 20`)
      .all(now) as unknown as ScheduledJobRow[];

    for (const job of rows) {
      try {
        await this.runJob(job);
      } catch (err) {
        console.error(`[scheduler] job #${job.id} failed:`, err);
        // On failure, still reschedule to avoid tight loops
      } finally {
        const spec = JSON.parse(job.schedule_spec_json) as ScheduleSpec;
        const next = this.computeNextRun(spec, new Date());
        this.db.prepare(`UPDATE scheduled_jobs SET last_run = ?, next_run = ?, updated_at = ? WHERE id = ?`).run(Date.now(), next, Date.now(), job.id);
      }
    }
  }

  private async runJob(job: ScheduledJobRow): Promise<void> {
    if (job.mode === 'tool') {
      const tool = job.tool_name as string;
      const params = job.parameters_json ? JSON.parse(job.parameters_json) : {};
      const result = await this.executeTool(tool, params, { channel: job.channel, actorNick: job.actor_nick || undefined });
      if (result && result.trim().length > 0) {
        await this.sendMessage(job.channel, result.trim());
      }
    } else if (job.mode === 'prompt') {
      const text = (job.command_text || '').trim();
      if (!text) return;
      await this.submitPrompt(job.channel, job.actor_nick || undefined, text);
    }
  }

  listJobs(channel?: string): ScheduledJobRow[] {
    if (channel) {
      return this.db
        .prepare(`SELECT * FROM scheduled_jobs WHERE channel = ? ORDER BY next_run ASC`)
        .all(channel) as unknown as ScheduledJobRow[];
    }
    return this.db
      .prepare(`SELECT * FROM scheduled_jobs ORDER BY next_run ASC`)
      .all() as unknown as ScheduledJobRow[];
  }

  cancelJob(id: number): boolean {
    const res = this.db.prepare(`UPDATE scheduled_jobs SET active = 0, updated_at = ? WHERE id = ?`).run(Date.now(), id);
    return res.changes > 0;
  }

  runJobNow(id: number): boolean {
    const res = this.db.prepare(`UPDATE scheduled_jobs SET next_run = ?, updated_at = ? WHERE id = ?`).run(Date.now(), Date.now(), id);
    return res.changes > 0;
  }

  scheduleJob(opts: CreateJobOptions): { id: number; nextRun: number; spec: ScheduleSpec } {
    const channel = opts.channel;
    const actorNick = opts.actorNick || null;
    const mode = opts.mode;

    if (mode === 'tool') {
      if (!opts.toolName) throw new Error('toolName required for tool mode');
    } else {
      if (!opts.commandText) throw new Error('commandText required for prompt mode');
    }

    const spec = opts.scheduleSpec || this.parseScheduleText(opts.scheduleText || '');
    const nextRun = this.computeNextRun(spec, new Date());
    const now = Date.now();

    const info = this.db.prepare(`
      INSERT INTO scheduled_jobs (
        channel, actor_nick, mode, tool_name, parameters_json, command_text,
        schedule_type, schedule_spec_json, next_run, last_run, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)
    `).run(
      channel,
      actorNick,
      mode,
      mode === 'tool' ? (opts.toolName as string) : null,
      mode === 'tool' ? JSON.stringify(opts.parameters || {}) : null,
      mode === 'prompt' ? (opts.commandText as string) : null,
      spec.kind,
      JSON.stringify(spec),
      nextRun,
      now,
      now
    );

    const id = Number((info as any).lastInsertRowid);
    return { id, nextRun, spec };
  }

  // Parse strings like:
  // - "every hour"
  // - "every 2 hours"
  // - "every 15 minutes"
  // - "every day at 5pm" / "every day at 17:00"
  // - "every monday at 9am"
  parseScheduleText(text: string): ScheduleSpec {
    const raw = (text || '').trim();
    const s = raw.toLowerCase();

    // Accept explicit cron expressions
    const cronPrefix = s.match(/^cron[:\s]+(.+)$/);
    if (cronPrefix) {
      const expr = cronPrefix[1].trim();
      return { kind: 'cron', cronExpr: expr };
    }
    if (looksLikeCron(raw)) {
      return { kind: 'cron', cronExpr: raw };
    }

    if (!s.startsWith('every')) {
      // Default to every hour if nothing recognizable
      return { kind: 'interval', intervalMinutes: 60 };
    }

    // every hour
    if (/^every\s+hour$/.test(s) || /^every\s+1\s*hour$/.test(s) || /^every\s+hourly$/.test(s)) {
      return { kind: 'interval', intervalMinutes: 60 };
    }

    // every N minutes/hours/days
    const m1 = s.match(/^every\s+(\d+)\s*(minute|minutes|min|hour|hours|hr|hrs|day|days)$/);
    if (m1) {
      const n = parseInt(m1[1], 10);
      const unit = m1[2];
      let minutes = n;
      if (/hour|hr/.test(unit)) minutes = n * 60;
      if (/day/.test(unit)) minutes = n * 24 * 60;
      return { kind: 'interval', intervalMinutes: minutes };
    }

    // every day at TIME
    const m2 = s.match(/^every\s+day(?:\s+at\s+(.+))?$/);
    if (m2) {
      const timeStr = (m2[1] || '09:00').trim();
      const tod = parseTimeOfDay(timeStr);
      return { kind: 'daily', timeOfDay: tod };
    }

    // every <weekday> at TIME
    const m3 = s.match(/^every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+at\s+(.+)$/);
    if (m3) {
      const day = this.parseWeekday(m3[1]);
      const tod = parseTimeOfDay(m3[2]);
      return { kind: 'weekly', dayOfWeek: day, timeOfDay: tod };
    }

    // every month on the 15th at 09:00
    const m4 = s.match(/^every\s+month\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\s+at\s+(.+)$/);
    if (m4) {
      const day = Math.max(1, Math.min(31, parseInt(m4[1], 10)));
      const tod = parseTimeOfDay(m4[2]);
      const expr = `${tod.minute} ${tod.hour} ${day} * *`;
      return { kind: 'cron', cronExpr: expr };
    }

    // every year on june 1 at 10am
    const m5 = s.match(/^every\s+year\s+on\s+([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+at\s+(.+)$/);
    if (m5) {
      const mon = parseMonth(m5[1]);
      const day = Math.max(1, Math.min(31, parseInt(m5[2], 10)));
      const tod = parseTimeOfDay(m5[3]);
      const expr = `${tod.minute} ${tod.hour} ${day} ${mon} *`;
      return { kind: 'cron', cronExpr: expr };
    }

    // Fallback: try just a time -> daily at time
    if (/\d/.test(s)) {
      const tod = parseTimeOfDay(s);
      return { kind: 'daily', timeOfDay: tod };
    }

    // Default hourly
    return { kind: 'interval', intervalMinutes: 60 };
  }

  // parseWeekday remains; time-of-day is provided by a module-level helper

  private parseWeekday(s: string): number {
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    return Math.max(0, days.indexOf(s.toLowerCase()));
  }

  computeNextRun(spec: ScheduleSpec, from: Date): number {
    const now = new Date(from.getTime());
    if (spec.kind === 'interval') {
      const minutes = Math.max(1, spec.intervalMinutes || 60);
      return now.getTime() + minutes * 60_000;
    }
    if (spec.kind === 'daily' && spec.timeOfDay) {
      const t = new Date(now.getTime());
      t.setSeconds(0, 0);
      t.setHours(spec.timeOfDay.hour, spec.timeOfDay.minute, 0, 0);
      if (t.getTime() <= now.getTime()) {
        t.setDate(t.getDate() + 1);
      }
      return t.getTime();
    }
    if (spec.kind === 'weekly' && spec.timeOfDay != null && spec.dayOfWeek != null) {
      const t = new Date(now.getTime());
      t.setSeconds(0, 0);
      t.setHours(spec.timeOfDay.hour, spec.timeOfDay.minute, 0, 0);
      const nowDow = t.getDay();
      let addDays = (spec.dayOfWeek - nowDow + 7) % 7;
      if (addDays === 0 && t.getTime() <= now.getTime()) addDays = 7;
      t.setDate(t.getDate() + addDays);
      return t.getTime();
    }
    if (spec.kind === 'cron' && spec.cronExpr) {
      return computeNextRunCron(spec.cronExpr, now);
    }
    // Fallback: 1 hour later
    return now.getTime() + 60_000;
  }
}

// Exported helper for plugins needing to parse times politely
export function parseTimeOfDay(text: string): { hour: number; minute: number } {
  const str = String(text || '').trim().toLowerCase();
  // Formats: 17:00, 5pm, 5:30pm, 05:30, 12am
  const ampm = str.match(/(am|pm)$/);
  let core = str.replace(/\s*(am|pm)\s*$/, '');
  let hour = 0, minute = 0;
  if (core.includes(':')) {
    const [h, m] = core.split(':');
    hour = parseInt(h, 10);
    minute = parseInt(m, 10) || 0;
  } else {
    hour = parseInt(core, 10);
    minute = 0;
  }
  if (ampm) {
    const ap = ampm[1];
    if (ap === 'am') {
      if (hour === 12) hour = 0;
    } else {
      if (hour !== 12) hour += 12;
    }
  }
  hour = Math.max(0, Math.min(23, hour));
  minute = Math.max(0, Math.min(59, minute));
  return { hour, minute };
}

// ---- Minimal cron parsing helpers ----
interface CronSpec { minutes: Set<number>; hours: Set<number>; dom: Set<number>; months: Set<number>; dow: Set<number>; }

function computeNextRunCron(expr: string, from: Date): number {
  const cron = parseCron(expr);
  const t = new Date(from.getTime());
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);
  const limit = new Date(from.getTime());
  limit.setFullYear(limit.getFullYear() + 1);

  while (t <= limit) {
    const minute = t.getMinutes();
    const hour = t.getHours();
    const dom = t.getDate();
    const mon = t.getMonth() + 1;
    const dow = t.getDay();

    if (cron.minutes.has(minute) &&
        cron.hours.has(hour) &&
        cron.months.has(mon) &&
        cron.dom.has(dom) &&
        cron.dow.has(dow)) {
      return t.getTime();
    }
    t.setMinutes(t.getMinutes() + 1);
  }
  return from.getTime() + 24 * 60 * 60 * 1000;
}

function looksLikeCron(raw: string): boolean {
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const okToken = (p: string) => /^(\*|\d+|[a-zA-Z]+)([\/,\-](\*|\d+|[a-zA-Z]+))*$/.test(p);
  return parts.every(okToken);
}

function parseCron(expr: string): CronSpec {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression (need 5 fields): ${expr}`);
  const [minF, hourF, domF, monF, dowF] = parts;
  return {
    minutes: parseCronField(minF, 0, 59),
    hours: parseCronField(hourF, 0, 23),
    dom: parseCronField(domF, 1, 31),
    months: parseCronField(monF, 1, 12, monthMap),
    dow: parseCronField(dowF, 0, 6, dayMap),
  };
}

function parseCronField(field: string, min: number, max: number, names?: Record<string, number>): Set<number> {
  const result = new Set<number>();
  const add = (v: number) => { if (v >= min && v <= max) result.add(v); };
  const expandRange = (start: number, end: number, step: number) => {
    if (end < start) return;
    for (let v = start; v <= end; v += step) add(v);
  };

  const norm = (s: string) => s.trim().toLowerCase();
  const translate = (token: string): number | null => {
    const n = Number(token);
    if (!Number.isNaN(n)) return n;
    if (names) {
      const mapVal = names[norm(token)];
      if (mapVal !== undefined) return mapVal;
    }
    return null;
  };

  for (const part of field.split(',')) {
    const p = part.trim();
    if (p === '*') {
      expandRange(min, max, 1);
      continue;
    }
    const stepIdx = p.indexOf('/');
    let base = p;
    let step = 1;
    if (stepIdx >= 0) {
      base = p.slice(0, stepIdx);
      const stepVal = Number(p.slice(stepIdx + 1));
      if (!Number.isNaN(stepVal) && stepVal > 0) step = stepVal;
    }
    if (base.includes('-')) {
      const [a, b] = base.split('-');
      const start = translate(a);
      const end = translate(b);
      if (start == null || end == null) continue;
      expandRange(start, end, step);
      continue;
    }
    const single = translate(base);
    if (single != null) add(single);
  }

  return result.size ? result : new Set<number>();
}

function parseMonth(s: string): number {
  const n = monthMap[s.toLowerCase()];
  if (!n) throw new Error(`Invalid month: ${s}`);
  return n;
}

const monthMap: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const dayMap: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
  '7': 0,
};
