/**
 * Logging utility for X Outreach Agent
 */

export interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

export class Logger {
  private logs: LogEntry[] = [];
  private isDev = process.env.NODE_ENV === "development";

  constructor(private component: string) {}

  debug(message: string, data?: Record<string, unknown>) {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>) {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>) {
    this.log("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>) {
    this.log("error", message, data);
  }

  private log(level: "debug" | "info" | "warn" | "error", message: string, data?: Record<string, unknown>) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      data,
    };

    this.logs.push(entry);

    if (this.isDev || level === "error") {
      console.log(`[${level.toUpperCase()}] [${this.component}] ${message}`, data || "");
    }
  }

  getLogs(filter?: { level?: string; component?: string }): LogEntry[] {
    if (!filter) return this.logs;
    return this.logs.filter((log) => {
      if (filter.level && log.level !== filter.level) return false;
      if (filter.component && log.component !== filter.component) return false;
      return true;
    });
  }

  clear() {
    this.logs = [];
  }
}

export const createLogger = (component: string) => new Logger(component);
