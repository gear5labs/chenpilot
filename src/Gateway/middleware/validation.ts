import { Request, Response, NextFunction } from "express";
import { validate, ValidationError, ValidatorOptions } from "class-validator";
import { plainToInstance, ClassTransformOptions } from "class-transformer";
import logger from "../../config/logger";

/**
 * Standardized validation error response format
 */
export interface ValidationErrorItem {
  field: string;
  message: string;
  constraints?: Record<string, string>;
  value?: unknown;
}

export interface ValidationErrorResponse {
  success: false;
  error: {
    message: string;
    code: string;
    details: ValidationErrorItem[];
  };
}

/**
 * Options for the validation middleware
 */
export interface ValidationOptions {
  /** The DTO class to validate against */
  dtoClass: new () => object;
  /** Where to read data from (body, query, params) */
  source?: "body" | "query" | "params";
  /** Additional validator options */
  validatorOptions?: ValidatorOptions;
  /** Additional class-transformer options */
  transformOptions?: ClassTransformOptions;
  /** Custom error message prefix */
  messagePrefix?: string;
}

/**
 * Default validator options
 */
const DEFAULT_VALIDATOR_OPTIONS: ValidatorOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
  transform: true,
};

/**
 * Default transform options
 */
const DEFAULT_TRANSFORM_OPTIONS: ClassTransformOptions = {
  excludeExtraneousValues: true,
  enableImplicitConversion: true,
};

/**
 * Create validation middleware for a specific DTO
 *
 * @example
 * ```typescript
 * // Create a DTO class
 * class LoginDto {
 *   @IsString()
 *   @MinLength(1)
 *   name: string;
 * }
 *
 * // Use in route
 * router.post('/login', validateBody(LoginDto), async (req, res) => {
 *   // req.body is now typed as LoginDto with validated values
 * });
 * ```
 */
export function validateBody<T extends object>(
  dtoClass: new () => T,
  options?: Partial<Omit<ValidationOptions, "source" | "dtoClass">>
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return createValidationMiddleware({
    dtoClass,
    source: "body",
    ...options,
  });
}

export function validateQuery<T extends object>(
  dtoClass: new () => T,
  options?: Partial<Omit<ValidationOptions, "source" | "dtoClass">>
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return createValidationMiddleware({
    dtoClass,
    source: "query",
    ...options,
  });
}

export function validateParams<T extends object>(
  dtoClass: new () => T,
  options?: Partial<Omit<ValidationOptions, "source" | "dtoClass">>
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return createValidationMiddleware({
    dtoClass,
    source: "params",
    ...options,
  });
}

/**
 * Create validation middleware with custom configuration
 */
export function createValidationMiddleware(
  config: ValidationOptions
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const {
    dtoClass,
    source = "body",
    validatorOptions = {},
    transformOptions = {},
    messagePrefix,
  } = config;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get the data to validate based on source
      const dataToValidate =
        source === "query"
          ? req.query
          : source === "params"
            ? req.params
            : req.body;

      // Transform plain object to DTO instance with class-transformer
      const dtoInstance = plainToInstance(dtoClass, dataToValidate, {
        ...DEFAULT_TRANSFORM_OPTIONS,
        ...transformOptions,
      });

      // Validate the DTO
      const validationErrors = await validate(dtoInstance, {
        ...DEFAULT_VALIDATOR_OPTIONS,
        ...validatorOptions,
      });

      // If there are validation errors, return standardized error response
      if (validationErrors.length > 0) {
        const errorResponse = formatValidationErrors(
          validationErrors,
          messagePrefix
        );

        logger.warn("Validation failed", {
          path: req.path,
          method: req.method,
          source,
          errorCount: validationErrors.length,
          errors: errorResponse.error.details,
        });

        return res.status(400).json(errorResponse);
      }

      // Replace the original data with the validated DTO instance
      if (source === "query") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        req.query = dtoInstance as any;
      } else if (source === "params") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        req.params = dtoInstance as any;
      } else {
        req.body = dtoInstance;
      }

      next();
    } catch (error) {
      logger.error("Validation middleware error", {
        error,
        path: req.path,
        method: req.method,
      });

      // Handle transformation errors
      if (error instanceof Error) {
        return res.status(400).json({
          success: false,
          error: {
            message: `Invalid ${source} format: ${error.message}`,
            code: "INVALID_FORMAT",
            details: [],
          },
        } as ValidationErrorResponse);
      }

      next(error);
    }
  };
}

/**
 * Format class-validator errors into standardized response
 */
export function formatValidationErrors(
  errors: ValidationError[],
  messagePrefix?: string
): ValidationErrorResponse {
  const formattedErrors: ValidationErrorItem[] = errors.flatMap((error) => {
    // For nested objects, recurse
    if (error.children && error.children.length > 0) {
      return formatNestedErrors(error.property, error.children);
    }

    // Get constraints and format them
    const constraints = error.constraints
      ? Object.entries(error.constraints).reduce(
          (acc, [key, value]) => {
            acc[key] = value;
            return acc;
          },
          {} as Record<string, string>
        )
      : undefined;

    return [
      {
        field: error.property,
        message:
          Object.values(error.constraints || {}).join(", ") || "Invalid value",
        constraints,
        value: error.value,
      },
    ];
  });

  const prefix = messagePrefix ? `${messagePrefix}: ` : "";
  const primaryMessage =
    formattedErrors.length === 1
      ? `${prefix}${formattedErrors[0].message}`
      : `${prefix}Validation failed with ${formattedErrors.length} error(s)`;

  return {
    success: false,
    error: {
      message: primaryMessage,
      code: "VALIDATION_ERROR",
      details: formattedErrors,
    },
  };
}

/**
 * Recursively format nested validation errors
 */
function formatNestedErrors(
  parentProperty: string,
  children: ValidationError[]
): ValidationErrorItem[] {
  return children.flatMap((error) => {
    const fullPath = `${parentProperty}.${error.property}`;

    if (error.children && error.children.length > 0) {
      return formatNestedErrors(fullPath, error.children);
    }

    const constraints = error.constraints
      ? Object.entries(error.constraints).reduce(
          (acc, [key, value]) => {
            acc[key] = value;
            return acc;
          },
          {} as Record<string, string>
        )
      : undefined;

    return [
      {
        field: fullPath,
        message:
          Object.values(error.constraints || {}).join(", ") || "Invalid value",
        constraints,
        value: error.value,
      },
    ];
  });
}

/**
 * Utility to validate a DTO and return errors without middleware
 */
export async function validateDto<T extends object>(
  dtoClass: new () => T,
  data: unknown,
  options?: Partial<ValidationOptions>
): Promise<{ valid: boolean; errors?: ValidationErrorItem[]; instance?: T }> {
  const dtoInstance = plainToInstance(
    dtoClass,
    data as object,
    DEFAULT_TRANSFORM_OPTIONS
  );

  const validationErrors = await validate(dtoInstance, {
    ...DEFAULT_VALIDATOR_OPTIONS,
    ...options?.validatorOptions,
  });

  if (validationErrors.length > 0) {
    const formattedErrors = formatValidationErrors(validationErrors);
    return {
      valid: false,
      errors: formattedErrors.error.details,
    };
  }

  return {
    valid: true,
    instance: dtoInstance,
  };
}
