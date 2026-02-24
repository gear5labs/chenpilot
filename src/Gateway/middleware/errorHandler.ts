import { Request, Response, NextFunction } from "express";
import logger from "../../config/logger";
import { ApplicationError } from "../../utils/error";

/**
 * Interface for the standardized error response
 */
interface StandardErrorResponse {
  success: boolean;
  status: number;
  error: {
    message: string;
    code: string;
    details?: unknown;
    stack?: string;
  };
}

/**
 * Centralized error handling middleware
 */
export async function ErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
) {
  const error = err as {
    message?: string;
    stack?: string;
    code?: string;
    column?: string;
  };
  let statusCode = 500;
  let message = "Internal server error";
  let errorCode = "INTERNAL_SERVER_ERROR";
  const details: unknown = undefined;

  // Handle custom ApplicationErrors
  if (error instanceof ApplicationError) {
    statusCode = error.statusCode;
    message = error.message;
    errorCode =
      error.constructor.name.replace(/Error$/, "").toUpperCase() + "_ERROR";
  }
  // Handle database (TypeORM) errors
  else if (error.code) {
    switch (error.code) {
      case "23502": // Not null violation
        message = error.column
          ? `Field '${error.column}' cannot be empty.`
          : "A required field is missing.";
        statusCode = 400;
        errorCode = "MISSING_FIELD";
        break;
      case "23505": // Unique violation
        message = "Duplicate entry. This record already exists.";
        statusCode = 409;
        errorCode = "DUPLICATE_ENTRY";
        break;
      case "23503": // Foreign key violation
        message = "Invalid reference. The related record does not exist.";
        statusCode = 400;
        errorCode = "INVALID_REFERENCE";
        break;
      case "22001": // Value too long
        message = "Data is too long for the specified field.";
        statusCode = 400;
        errorCode = "VALUE_TOO_LONG";
        break;
      case "22007": // Invalid datetime format
        message = "Invalid date/time format.";
        statusCode = 400;
        errorCode = "INVALID_DATE_FORMAT";
        break;
      case "22P02": // Invalid text representation
        message = "Invalid input format.";
        statusCode = 400;
        errorCode = "INVALID_INPUT_FORMAT";
        break;
      case "23514": // Check violation
        message = "Field value does not meet required constraints.";
        statusCode = 400;
        errorCode = "CONSTRAINT_VIOLATION";
        break;
      default:
        // Use pre-existing message if it's from a library we trust
        if (error.message) message = error.message;
        break;
    }
  } else if (error.message) {
    message = error.message;
  }

  // Log the error with context
  logger.error("Request error", {
    message: error.message || "No message provided",
    statusCode,
    errorCode,
    method: req.method,
    url: req.originalUrl,
    stack: error.stack,
  });

  const response: StandardErrorResponse = {
    success: false,
    status: statusCode,
    error: {
      message,
      code: errorCode,
      details,
      // Only include stack trace in development
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    },
  };

  return res.status(statusCode).json(response);
}
