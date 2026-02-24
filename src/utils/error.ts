import express, { NextFunction } from "express";

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

export default RouteErrorHandler;
