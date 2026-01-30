/* eslint-env node */
import express, { NextFunction } from "express";
import logger from "../config/logger";


export class ApplicationError extends Error {
  statusCode: number;
  message: string;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.message = message;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends ApplicationError {
  constructor(message: string, statusCode = 404) {
    super(message, statusCode);
  }
}

export class BadError extends ApplicationError {
  constructor(message: string, statusCode = 400) {
    super(message, statusCode);
  }
}

export class InternalServerError extends ApplicationError {
  constructor(message: string, statusCode = 500) {
    super(message, statusCode);
  }
}

export class ConflictError extends ApplicationError {
  constructor(message: string, statusCode = 409) {
    super(message, statusCode);
  }
}

export class RequiredFieldsError extends ApplicationError {
  constructor(message: string, statusCode = 422) {
    super(message, statusCode);
  }
}

export class ValidationError extends ApplicationError {
  constructor(message: string, statusCode = 422) {
    super(message, statusCode);
  }
}

export class InvalidPayloadError extends ApplicationError {
  constructor(message: string, statusCode = 400) {
    super(message, statusCode);
  }
}

export class MissingFieldsError extends ApplicationError {
  constructor(message: string, statusCode = 400) {
    super(message, statusCode);
  }
}

export class ForbiddenError extends ApplicationError {
  constructor(message: string, statusCode = 403) {
    super(message, statusCode);
  }
}
export class UnauthorizedError extends ApplicationError {
  constructor(message: string, statusCode = 401) {
    super(message, statusCode);
  }
}

const RouteErrorHandler =
  (
    fn: (
      req: express.Request,
      res: express.Response,
      next: NextFunction
    ) => Promise<unknown>
  ) =>
  (req: express.Request, res: express.Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch((error) => next(error));

export async function ErrorHandler(
  err: {
    statusCode?: number;
    code?: string;
    column?: string;
    message?: string;
    stack?: string;
  },
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  let message = err?.message || "Internal server error";
  let statusCode = err?.statusCode || 500;

  // Log the error with context
  logger.error("Request error", {
    message: err?.message,
    statusCode,
    code: err?.code,
    method: req.method,
    url: req.originalUrl,
    stack: err?.stack,
  });

  switch (err.code) {
    case "23502":
      message = err.column
        ? `Field '${err.column}' cannot be empty.`
        : "A required field is missing.";
      statusCode = 400;
      break;
    case "23505":
      message = "Duplicate entry. This record already exists.";
      statusCode = 409;
      break;
    case "23503":
      message = "Invalid reference. The related record does not exist.";
      statusCode = 400;
      break;
    case "22001":
      message = "Data is too long for the specified field.";
      statusCode = 400;
      break;
    case "22007":
      message = "Invalid date/time format.";
      statusCode = 400;
      break;
    case "22P02":
      message = "Invalid input format.";
      statusCode = 400;
      break;
    case "23514":
      message = "Field value does not meet required constraints.";
      statusCode = 400;
      break;
    default:
      break;
  }

  return res.status(statusCode).json({
    success: false,
    status: statusCode,
    message,
  });
}

export default RouteErrorHandler;
