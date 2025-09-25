import { Request, Response, NextFunction } from "express";
import { injectable, inject } from "tsyringe";
import { AuthService } from "./auth.service";

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
  };
}

@injectable()
export class AuthMiddleware {
  constructor(
    @inject("AuthService") private authService: AuthService
  ) {}

  authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({
          success: false,
          message: "Access token is required",
        });
        return;
      }

      const token = authHeader.substring(7); // Remove "Bearer " prefix
      
      try {
        const decoded = this.authService.verifyToken(token);
        req.user = { userId: decoded.userId };
        next();
      } catch (error) {
        res.status(401).json({
          success: false,
          message: "Invalid or expired token",
        });
        return;
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Authentication error",
      });
    }
  };

  optionalAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7);
        
        try {
          const decoded = this.authService.verifyToken(token);
          req.user = { userId: decoded.userId };
        } catch (error) {
          // Token is invalid, but we continue without authentication
          req.user = undefined;
        }
      }
      
      next();
    } catch (error) {
      next();
    }
  };
}
