import { Plugin } from "../types";
import { Scheduler, ScheduleSpec, parseTimeOfDay } from "../scheduler";

function formatSpec(spec: ScheduleSpec): string {
  switch (spec.kind) {
    case 'interval':
      return `every ${spec.intervalMinutes} minute${spec.intervalMinutes && spec.intervalMinutes > 1 ? 's' : ''}`;
    case 'daily':
      return `every day at ${pad(spec.timeOfDay!.hour)}:${pad(spec.timeOfDay!.minute)}`;
    case 'weekly':
      return `every ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][spec.dayOfWeek!]} at ${pad(spec.timeOfDay!.hour)}:${pad(spec.timeOfDay!.minute)}`;
    case 'cron':
      return `cron ${spec.cronExpr}`;
    default:
      return 'custom schedule';
  }
}

function pad(n: number): string { return n.toString().padStart(2, '0'); }

export function createSchedulerPlugin(scheduler: Scheduler): Plugin {
  return {
    name: 'scheduler',
    description: 'Schedule recurring jobs to run tools or post prompts at specific times (hourly, daily, weekly).',
    tools: [
      {
        name: 'schedule_job',
        description: 'Create a new recurring job. Accepts either a natural schedule ("every hour", "every day at 5pm") or structured fields. Supports two modes: tool (tool_name + parameters) or prompt (command_text).',
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'IRC channel to post result in (default: current channel).' },
            schedule: { type: 'string', description: 'Human schedule: e.g., "every hour", "every day at 5pm", "every monday at 9am".' },
            cron: { type: 'string', description: 'Cron expression for advanced schedules (m h dom mon dow). Example: "*/30 9-17 * * mon-fri".' },
            mode: { type: 'string', description: "'tool' to run a plugin tool, 'prompt' to post natural command" , enum: ['tool','prompt'] },
            tool_name: { type: 'string', description: 'Tool function name to call (when mode = tool).' },
            parameters: { type: 'object', description: 'JSON parameters object for the tool (when mode = tool).' },
            command_text: { type: 'string', description: 'Natural-language command to post to the channel (when mode = prompt).' },
            // Structured overrides (optional)
            interval_minutes: { type: 'number', description: 'Run every N minutes (overrides schedule text).'},
            daily_time: { type: 'string', description: 'Time of day HH:MM or 5pm (overrides schedule text).'},
            weekly_day: { type: 'string', description: 'Day of week (e.g., Monday) with daily_time (overrides schedule text).'},
          },
          required: [],
        },
      },
      {
        name: 'list_jobs',
        description: 'List scheduled jobs (optionally for a channel).',
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'Filter by IRC channel' },
          },
          required: [],
        },
      },
      {
        name: 'cancel_job',
        description: 'Cancel a scheduled job by id.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'Scheduled job id' },
          },
          required: ['id'],
        },
      },
      {
        name: 'run_job_now',
        description: 'Trigger a job to run on the next tick (sets next_run to now).',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'Scheduled job id' },
          },
          required: ['id'],
        },
      },
    ],
    execute: async (toolName, parameters, ctx) => {
      switch (toolName) {
        case 'schedule_job': {
          const channel = parameters.channel || ctx?.channel;
          if (!channel) return 'Error: channel is required';

          // Determine mode
          let mode: 'tool' | 'prompt' | undefined = parameters.mode;
          if (!mode) {
            mode = parameters.tool_name ? 'tool' : 'prompt';
          }
          if (mode === 'tool' && !parameters.tool_name) return 'Error: tool_name is required for mode=tool';
          if (mode === 'prompt' && !parameters.command_text) return 'Error: command_text is required for mode=prompt';

          // Build spec: prefer explicit cron, then structured, otherwise natural text
          let spec: ScheduleSpec | undefined;
          if (typeof parameters.cron === 'string' && parameters.cron.trim()) {
            spec = { kind: 'cron', cronExpr: String(parameters.cron).trim() } as any;
          }
          if (typeof parameters.interval_minutes === 'number' && parameters.interval_minutes > 0) {
            spec = { kind: 'interval', intervalMinutes: Math.max(1, Math.floor(parameters.interval_minutes)) };
          } else if (parameters.weekly_day && parameters.daily_time) {
            const dow = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].indexOf(String(parameters.weekly_day).toLowerCase());
            if (dow < 0) return `Error: invalid weekly_day ${parameters.weekly_day}`;
            spec = { kind: 'weekly', dayOfWeek: dow, timeOfDay: parseTimeOfDay(parameters.daily_time) } as any;
          } else if (parameters.daily_time) {
            spec = { kind: 'daily', timeOfDay: parseTimeOfDay(parameters.daily_time) } as any;
          }

          const scheduleText: string | undefined = parameters.schedule || parameters.cron;

          const { id, nextRun, spec: savedSpec } = scheduler.scheduleJob({
            channel,
            actorNick: ctx?.actorNick,
            mode,
            toolName: mode === 'tool' ? parameters.tool_name : undefined,
            parameters: mode === 'tool' ? (parameters.parameters || {}) : undefined,
            commandText: mode === 'prompt' ? parameters.command_text : undefined,
            scheduleText: spec ? undefined : (scheduleText || ''),
            scheduleSpec: spec,
          });

          const when = new Date(nextRun).toLocaleString();
          return `Scheduled job #${id}: ${formatSpec(savedSpec)} -> ${mode === 'tool' ? parameters.tool_name : parameters.command_text}. Next run: ${when}`;
        }
        case 'list_jobs': {
          const jobs = scheduler.listJobs(parameters.channel);
          if (jobs.length === 0) return 'No scheduled jobs.';
          const lines = jobs.map(j => {
            const spec = JSON.parse(j.schedule_spec_json) as ScheduleSpec;
            const next = new Date(j.next_run).toLocaleString();
            const status = j.active ? 'active' : 'inactive';
            const action = j.mode === 'tool' ? (j.tool_name || '') : (j.command_text || '');
            return `#${j.id} ${status} ${formatSpec(spec)} -> ${action} (channel: ${j.channel}, next: ${next})`;
          });
          return lines.join('\n');
        }
        case 'cancel_job': {
          const ok = scheduler.cancelJob(parameters.id);
          return ok ? `Cancelled job #${parameters.id}` : `Job #${parameters.id} not found`;
        }
        case 'run_job_now': {
          const ok = scheduler.runJobNow(parameters.id);
          return ok ? `Queued job #${parameters.id} to run now` : `Job #${parameters.id} not found`;
        }
      }
      throw new Error(`Unknown tool: ${toolName}`);
    },
  };
}
