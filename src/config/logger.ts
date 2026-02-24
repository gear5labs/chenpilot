import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import path from "path";

// Sensitive fields to redact from logs
const SENSITIVE_FIELDS = ["pk", "privateKey", "password", "token", "secret"];

/**
 * Recursively redacts sensitive data from objects
 */
function redactSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item));
  }

  if (typeof obj === "object") {
    const redacted: Record<string, unknown> = {};
    for (const key in obj as Record<string, unknown>) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        if (SENSITIVE_FIELDS.includes(key)) {
          redacted[key] = "[REDACTED]";
        } else {
          redacted[key] = redactSensitiveData((obj as Record<string, unknown>)[key]);
        }
      }
    }
    return redacted;
  }

  return obj;
}

// Custom format to redact sensitive data
const redactFormat = winston.format((info) => {
  // Redact sensitive data from the main message if it's an object
  if (typeof info.message === "object") {
    info.message = redactSensitiveData(info.message);
  }

  // Redact from metadata
  const { level, message, timestamp, ...meta } = info;
  const redactedMeta = redactSensitiveData(meta);

  return {
    level,
    message,
    timestamp,
    ...redactedMeta,
  };
});

// Log format configuration
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  redactFormat(),
  winston.format.printf((info) => {
    const { timestamp, level, message, stack, ...meta } = info;
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;

    // Add stack trace for errors
    if (stack) {
      log += `\n${stack}`;
    }

    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      log += `\n${JSON.stringify(meta, null, 2)}`;
    }

    return log;
  })
);

// JSON format for file logs
const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  redactFormat(),
  winston.format.json()
);

// Create logs directory path
const logsDir = path.join(process.cwd(), "logs");

// Daily rotate file transport for all logs
const dailyRotateFileTransport = new DailyRotateFile({
  filename: path.join(logsDir, "application-%DATE%.log"),
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxSize: "20m",
  maxFiles: "14d", // Keep logs for 14 days
  format: jsonFormat,
});

// Daily rotate file transport for error logs only
const errorRotateFileTransport = new DailyRotateFile({
  level: "error",
  filename: path.join(logsDir, "error-%DATE%.log"),
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxSize: "20m",
  maxFiles: "30d", // Keep error logs for 30 days
  format: jsonFormat,
});

// Console transport for development
const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    redactFormat(),
    winston.format.printf((info) => {
      const { timestamp, level, message, stack, ...meta } = info;
      let log = `${timestamp} [${level}]: ${message}`;

      if (stack) {
        log += `\n${stack}`;
      }

      if (Object.keys(meta).length > 0) {
        log += `\n${JSON.stringify(meta, null, 2)}`;
      }

      return log;
    })
  ),
});

// Create Winston logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  transports: [
    dailyRotateFileTransport,
    errorRotateFileTransport,
    consoleTransport,
  ],
  exceptionHandlers: [
    new DailyRotateFile({
      filename: path.join(logsDir, "exceptions-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "30d",
      format: jsonFormat,
    }),
  ],
  rejectionHandlers: [
    new DailyRotateFile({
      filename: path.join(logsDir, "rejections-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "30d",
      format: jsonFormat,
    }),
  ],
  exitOnError: false,
});

// Helper functions for common log patterns
export const logError = (message: string, error?: Error | unknown, meta?: Record<string, unknown>) => {
  logger.error(message, { error: error?.message || error, stack: error?.stack, ...meta });
};

export const logInfo = (message: string, meta?: Record<string, unknown>) => {
  logger.info(message, meta);
};

export const logWarn = (message: string, meta?: Record<string, unknown>) => {
  logger.warn(message, meta);
};

export const logDebug = (message: string, meta?: Record<string, unknown>) => {
  logger.debug(message, meta);
};

export default logger;
