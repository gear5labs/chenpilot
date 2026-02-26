import { injectable } from "tsyringe";
import { Repository } from "typeorm";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { User } from "./user.entity";
import AppDataSource from "../config/Datasource";
import { type TokenService, tokenService } from "../services/token.service";
import { type EmailService, emailService } from "../services/email.service";
import { BadError, NotFoundError, UnauthorizedError } from "../utils/error";
import logger from "../config/logger";
import { auditLogService } from "../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../AuditLog/auditLog.entity";

export interface ForgotPasswordPayload {
  email: string;
}

export interface ResetPasswordPayload {
  token: string;
  newPassword: string;
}

export interface VerifyEmailPayload {
  token: string;
}

@injectable()
export class AuthService {
  private userRepository: Repository<User>;
  private tokenService: TokenService;
  private emailService: EmailService;

  constructor() {
    this.userRepository = AppDataSource.getRepository(User);
    this.tokenService = tokenService;
    this.emailService = emailService;
  }

  /**
   * Initiates password reset flow by sending reset email.
   * Always returns a generic message to prevent email enumeration.
   */
  async forgotPassword(
    payload: ForgotPasswordPayload
  ): Promise<{ message: string }> {
    const { email } = payload;

    if (!email || !this.isValidEmail(email)) {
      throw new BadError("Valid email is required");
    }

    const user = await this.userRepository.findOne({ where: { email } });

    // Always return success message to prevent email enumeration
    if (!user) {
      logger.info("Password reset requested for non-existent email", {
        email,
      });

      // Log failed attempt
      await auditLogService.log({
        action: AuditAction.PASSWORD_RESET_REQUEST,
        severity: AuditSeverity.WARNING,
        metadata: { email, reason: "User not found" },
        success: false,
      });

      return {
        message:
          "If an account with that email exists, a reset link has been sent",
      };
    }

    // Generate reset token
    const resetToken = this.tokenService.generateResetToken({
      userId: user.id,
      email: user.email!,
      type: "password_reset",
    });

    // Hash token for storage
    const tokenHash = this.hashToken(resetToken);

    // Update user with reset token hash and expiry
    user.resetTokenHash = tokenHash;
    user.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour reset token
    await this.userRepository.save(user);

    // Send reset email
    const emailSent = await this.emailService.sendPasswordResetEmail(
      email,
      resetToken
    );

    if (!emailSent) {
      logger.error("Failed to send password reset email", {
        userId: user.id,
        email,
      });
    }

    // Log successful password reset request
    await auditLogService.log({
      userId: user.id,
      action: AuditAction.PASSWORD_RESET_REQUEST,
      severity: AuditSeverity.INFO,
      metadata: { email },
    });

    logger.info("Password reset initiated", { userId: user.id, email });

    return {
      message:
        "If an account with that email exists, a reset link has been sent",
    };
  }

  /**
   * Resets user password using valid reset token.
   */
  async resetPassword(
    payload: ResetPasswordPayload
  ): Promise<{ message: string }> {
    const { token, newPassword } = payload;

    if (!token) {
      throw new BadError("Reset token is required");
    }

    if (!newPassword || newPassword.length < 8) {
      throw new BadError("Password must be at least 8 characters long");
    }

    // Verify JWT token
    const decoded = this.tokenService.verifyToken(token);

    if (!decoded || decoded.type !== "password_reset") {
      throw new UnauthorizedError("Invalid or expired reset token");
    }

    // Find user
    const user = await this.userRepository.findOne({
      where: { id: decoded.userId },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    // Verify token hash matches stored hash
    const tokenHash = this.hashToken(token);
    if (user.resetTokenHash !== tokenHash) {
      throw new UnauthorizedError("Invalid or expired reset token");
    }

    // Check if token has expired in DB
    if (user.resetTokenExpiry && new Date() > user.resetTokenExpiry) {
      throw new UnauthorizedError("Reset token has expired");
    }

    // Hash new password and save
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    user.password = hashedPassword;
    user.resetTokenHash = undefined;
    user.resetTokenExpiry = undefined;
    await this.userRepository.save(user);

    // Log successful password reset
    await auditLogService.log({
      userId: user.id,
      action: AuditAction.PASSWORD_RESET_SUCCESS,
      severity: AuditSeverity.INFO,
      metadata: { email: user.email },
    });

    logger.info("Password reset completed", { userId: user.id });

    return { message: "Password has been reset successfully" };
  }

  /**
   * Sends email verification to user.
   */
  async sendEmailVerification(userId: string): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (!user.email) {
      throw new BadError("User does not have an email address");
    }

    if (user.isEmailVerified) {
      return { message: "Email is already verified" };
    }

    // Generate verification token
    const verificationToken = this.tokenService.generateEmailVerificationToken({
      userId: user.id,
      email: user.email,
      type: "email_verification",
    });

    // Send verification email
    const emailSent = await this.emailService.sendEmailVerification(
      user.email,
      verificationToken
    );

    if (!emailSent) {
      logger.error("Failed to send email verification", {
        userId: user.id,
      });
      throw new BadError("Failed to send verification email");
    }

    // Log email verification sent
    await auditLogService.log({
      userId: user.id,
      action: AuditAction.EMAIL_VERIFICATION_SENT,
      severity: AuditSeverity.INFO,
      metadata: { email: user.email },
    });

    logger.info("Email verification sent", {
      userId: user.id,
      email: user.email,
    });

    return { message: "Verification email has been sent" };
  }

  /**
   * Verifies user email using verification token.
   */
  async verifyEmail(payload: VerifyEmailPayload): Promise<{ message: string }> {
    const { token } = payload;

    if (!token) {
      throw new BadError("Verification token is required");
    }

    // Verify JWT token
    const decoded = this.tokenService.verifyToken(token);

    if (!decoded || decoded.type !== "email_verification") {
      throw new UnauthorizedError("Invalid or expired verification token");
    }

    // Find user
    const user = await this.userRepository.findOne({
      where: { id: decoded.userId },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (user.isEmailVerified) {
      return { message: "Email is already verified" };
    }

    // Mark email as verified
    user.isEmailVerified = true;
    await this.userRepository.save(user);

    // Log successful email verification
    await auditLogService.log({
      userId: user.id,
      action: AuditAction.EMAIL_VERIFICATION_SUCCESS,
      severity: AuditSeverity.INFO,
      metadata: { email: user.email },
    });

    logger.info("Email verified", { userId: user.id, email: user.email });

    return { message: "Email has been verified successfully" };
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}

export const authService = new AuthService();
