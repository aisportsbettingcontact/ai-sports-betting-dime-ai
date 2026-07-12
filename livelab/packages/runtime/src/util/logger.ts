import * as fs from 'node:fs';
import * as path from 'node:path';
import { redactText } from '@livelab/protocol';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  workspaceId?: string;
  runtimeId?: string;
  sessionId?: string;
  navigationId?: string;
  testRunId?: string;
  reportId?: string;
  [key: string]: unknown;
}

/**
 * Structured logger with correlation identifiers. Human-readable lines go to
 * stderr (picked up by the extension Output channel); JSON lines optionally go
 * to `.livelab/logs/runtime.jsonl`. All text passes through redaction.
 */
export class Logger {
  private readonly base: LogContext;
  private jsonStream: fs.WriteStream | null = null;
  private bytesWritten = 0;
  private readonly maxJsonBytes = 20 * 1024 * 1024;

  constructor(base: LogContext = {}, jsonLogDir?: string) {
    this.base = base;
    if (jsonLogDir) {
      try {
        fs.mkdirSync(jsonLogDir, { recursive: true });
        this.jsonStream = fs.createWriteStream(path.join(jsonLogDir, 'runtime.jsonl'), {
          flags: 'a',
        });
      } catch {
        this.jsonStream = null;
      }
    }
  }

  child(ctx: LogContext): Logger {
    const child = new Logger({ ...this.base, ...ctx });
    child.jsonStream = this.jsonStream;
    return child;
  }

  private write(level: LogLevel, message: string, ctx?: LogContext): void {
    const clean = redactText(message);
    const record = {
      ts: new Date().toISOString(),
      level,
      message: clean,
      ...this.base,
      ...ctx,
    };
    const ctxStr = Object.entries({ ...this.base, ...ctx })
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(' ');
    process.stderr.write(`[livelab ${level}] ${clean}${ctxStr ? ` (${ctxStr})` : ''}\n`);
    if (this.jsonStream && this.bytesWritten < this.maxJsonBytes) {
      const line = JSON.stringify(record) + '\n';
      this.bytesWritten += line.length;
      this.jsonStream.write(line);
    }
  }

  debug(message: string, ctx?: LogContext): void {
    if (process.env.LIVELAB_DEBUG) this.write('debug', message, ctx);
  }
  info(message: string, ctx?: LogContext): void {
    this.write('info', message, ctx);
  }
  warn(message: string, ctx?: LogContext): void {
    this.write('warn', message, ctx);
  }
  error(message: string, ctx?: LogContext): void {
    this.write('error', message, ctx);
  }
}
