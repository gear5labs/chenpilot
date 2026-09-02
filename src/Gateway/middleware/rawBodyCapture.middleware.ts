import { Request, Response, NextFunction } from "express";
import { logger } from "../../Shared/logger";

/**
 * Maximum allowed webhook payload size (1MB)
 * Prevents memory exhaustion from oversized payloads
 */
const MAX_PAYLOAD_SIZE = 1024 * 1024; // 1MB

/**
 * Raw body capture middleware
 *
 * Captures the raw request body as a Buffer before JSON parsing occurs.
 * This is critical for webhook signature verification, which must operate
 * on the exact bytes sent by the provider to prevent signature bypass via
 * JSON canonicalization attacks.
 *
 * SECURITY: This middleware MUST be registered before express.json() in
 * the middleware chain to preserve the original payload bytes.
 *
 * Usage:
 *   app.use('/api/webhook', rawBodyCapture);
 *   app.use(express.json());
 */
export function rawBodyCapture(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Only capture raw body for webhook endpoints
  if (!req.path.includes("/webhook")) {
    next();
    return;
  }

  const chunks: Buffer[] = [];
  let totalSize = 0;

  req.on("data", (chunk: Buffer) => {
    totalSize += chunk.length;

    // Reject oversized payloads early to prevent DoS
    if (totalSize > MAX_PAYLOAD_SIZE) {
      logger.warn("Webhook payload exceeds maximum size", {
        path: req.path,
        totalSize,
        maxSize: MAX_PAYLOAD_SIZE,
        ip: req.ip,
      });

      res.status(413).json({
        success: false,
        message: "Payload too large",
      });

      // Destroy the request stream
      req.destroy();
      return;
    }

    chunks.push(chunk);
  });

  req.on("end", () => {
    // Store raw body as Buffer for signature verification
    (req as Request & { rawBody?: Buffer }).rawBody = Buffer.concat(chunks);

    logger.debug("Captured raw webhook body", {
      path: req.path,
      size: totalSize,
    });

    next();
  });

  req.on("error", (error) => {
    logger.error("Error reading webhook request body", {
      error,
      path: req.path,
    });

    res.status(400).json({
      success: false,
      message: "Error reading request body",
    });
  });
}
