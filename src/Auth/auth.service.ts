import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { injectable, inject } from "tsyringe";
import { AuthRepository } from "./auth.repository";
import { User, AuthProvider } from "./user.entity";
import nodemailer from "nodemailer";

export interface RegisterData {
  email: string;
  password: string;
  name?: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface GoogleAuthData {
  googleId: string;
  email: string;
  name: string;
  profilePicture?: string;
}

export interface AuthResponse {
  user: Omit<User, "password" | "emailVerificationToken" | "passwordResetToken">;
  token: string;
}

@injectable()
export class AuthService {
  private readonly JWT_SECRET: string;
  private readonly JWT_EXPIRES_IN: string;
  private readonly SALT_ROUNDS: number = 12;

  constructor(
    @inject("AuthRepository") private authRepository: AuthRepository
  ) {
    this.JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
    this.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
  }

  async register(data: RegisterData): Promise<AuthResponse> {
    const { email, password, name } = data;

    // Check if user already exists
    const existingUser = await this.authRepository.findByEmail(email);
    if (existingUser) {
      throw new Error("User with this email already exists");
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, this.SALT_ROUNDS);

    // Generate email verification token
    const emailVerificationToken = crypto.randomBytes(32).toString("hex");

    // Create user
    const user = await this.authRepository.create({
      email,
      password: hashedPassword,
      name: name || email.split("@")[0],
      authProvider: AuthProvider.EMAIL,
      emailVerificationToken,
      isEmailVerified: false,
    });

    // Generate JWT token
    const token = this.generateToken(user.id);

    return {
      user: this.sanitizeUser(user),
      token,
    };
  }

  async login(data: LoginData): Promise<AuthResponse> {
    const { email, password } = data;

    // Find user by email
    const user = await this.authRepository.findByEmail(email);
    if (!user) {
      throw new Error("Invalid email or password");
    }

    // Check if user has a password (not OAuth only)
    if (!user.password) {
      throw new Error("Please use Google sign-in for this account");
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new Error("Invalid email or password");
    }

    // Check if email is verified
    if (!user.isEmailVerified) {
      throw new Error("Please verify your email before logging in");
    }

    // Generate JWT token
    const token = this.generateToken(user.id);

    return {
      user: this.sanitizeUser(user),
      token,
    };
  }

  async googleAuth(data: GoogleAuthData): Promise<AuthResponse> {
    const { googleId, email, name, profilePicture } = data;

    // Check if user already exists with this Google ID
    let user = await this.authRepository.findByGoogleId(googleId);
    
    if (user) {
      // Update user info if needed
      if (user.name !== name || user.profilePicture !== profilePicture) {
        user = await this.authRepository.update(user.id, {
          name,
          profilePicture,
        });
      }
    } else {
      // Check if user exists with this email but different provider
      const existingUser = await this.authRepository.findByEmail(email);
      if (existingUser) {
        // Link Google account to existing user
        user = await this.authRepository.update(existingUser.id, {
          googleId,
          authProvider: AuthProvider.GOOGLE,
          name: name || existingUser.name,
          profilePicture,
          isEmailVerified: true, // Google emails are pre-verified
        });
      } else {
        // Create new user
        user = await this.authRepository.create({
          googleId,
          email,
          name,
          profilePicture,
          authProvider: AuthProvider.GOOGLE,
          isEmailVerified: true,
        });
      }
    }

    if (!user) {
      throw new Error("Failed to authenticate with Google");
    }

    // Generate JWT token
    const token = this.generateToken(user.id);

    return {
      user: this.sanitizeUser(user),
      token,
    };
  }

  async verifyEmail(token: string): Promise<boolean> {
    const user = await this.authRepository.findByEmailVerificationToken(token);
    if (!user) {
      throw new Error("Invalid or expired verification token");
    }

    await this.authRepository.updateEmailVerification(user.id, true);
    return true;
  }

  async resendVerificationEmail(email: string): Promise<boolean> {
    const user = await this.authRepository.findByEmail(email);
    if (!user) {
      throw new Error("User not found");
    }

    if (user.isEmailVerified) {
      throw new Error("Email is already verified");
    }

    // Generate new verification token
    const emailVerificationToken = crypto.randomBytes(32).toString("hex");
    await this.authRepository.update(user.id, { emailVerificationToken });

    // TODO: Send email with verification link
    return true;
  }

  private async sendResetEmail(email: string, resetToken: string): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.example.com",
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER || "your@email.com",
        pass: process.env.SMTP_PASS || "yourpassword",
      },
    });

    const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/reset-password?token=${resetToken}`;

    await transporter.sendMail({
      from: `"ChenPilot" <${process.env.SMTP_USER || "your@email.com"}>`,
      to: email,
      subject: "Password Reset Request",
      html: `
        <p>You requested a password reset.</p>
        <p>Click <a href="${resetUrl}">here</a> to reset your password.</p>
        <p>If you did not request this, please ignore this email.</p>
      `,
    });
  }

  async forgotPassword(email: string): Promise<boolean> {
    const user = await this.authRepository.findByEmail(email);
    if (!user) {
      // Don't reveal if user exists or not
      return true;
    }

    // Generate reset token
    const passwordResetToken = crypto.randomBytes(32).toString("hex");
    const passwordResetExpires = new Date(Date.now() + 3600000); // 1 hour

    await this.authRepository.updatePasswordResetToken(
      user.id,
      passwordResetToken,
      passwordResetExpires
    );

    // Send email with reset link
    await this.sendResetEmail(email, passwordResetToken);

    return true;
  }

  async resetPassword(token: string, newPassword: string): Promise<boolean> {
    const user = await this.authRepository.findByPasswordResetToken(token);
    if (!user || !user.passwordResetExpires || user.passwordResetExpires < new Date()) {
      throw new Error("Invalid or expired reset token");
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, this.SALT_ROUNDS);

    // Update password and clear reset token
    await this.authRepository.update(user.id, {
      password: hashedPassword,
      passwordResetToken: undefined,
      passwordResetExpires: undefined,
    });

    return true;
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
    const user = await this.authRepository.findById(userId);
    if (!user || !user.password) {
      throw new Error("User not found or no password set");
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      throw new Error("Current password is incorrect");
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, this.SALT_ROUNDS);

    // Update password
    await this.authRepository.update(userId, { password: hashedPassword });

    return true;
  }

  async getProfile(userId: string): Promise<Omit<User, "password" | "emailVerificationToken" | "passwordResetToken">> {
    const user = await this.authRepository.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    return this.sanitizeUser(user);
  }

  async updateProfile(userId: string, data: Partial<Pick<User, "name" | "profilePicture">>): Promise<Omit<User, "password" | "emailVerificationToken" | "passwordResetToken">> {
    const user = await this.authRepository.update(userId, data);
    if (!user) {
      throw new Error("User not found");
    }

    return this.sanitizeUser(user);
  }

  async deleteAccount(userId: string): Promise<boolean> {
    return await this.authRepository.delete(userId);
  }

  private generateToken(userId: string): string {
    return jwt.sign({ userId }, this.JWT_SECRET, { expiresIn: this.JWT_EXPIRES_IN } as jwt.SignOptions);
  }

  private sanitizeUser(user: User): Omit<User, "password" | "emailVerificationToken" | "passwordResetToken"> {
    const { password, emailVerificationToken, passwordResetToken, ...sanitizedUser } = user;
    return sanitizedUser;
  }

  verifyToken(token: string): { userId: string } {
    try {
      return jwt.verify(token, this.JWT_SECRET) as { userId: string };
    } catch (error) {
      throw new Error("Invalid or expired token");
    }
  }
}
