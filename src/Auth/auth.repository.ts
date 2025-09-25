import { Repository } from "typeorm";
import { injectable } from "tsyringe";
import AppDataSource from "../config/Datasource";
import { User, AuthProvider } from "./user.entity";

@injectable()
export class AuthRepository {
  private userRepository: Repository<User>;

  constructor() {
    this.userRepository = AppDataSource.getRepository(User);
  }

  async findByEmail(email: string): Promise<User | null> {
    return await this.userRepository.findOne({ where: { email } });
  }

  async findByGoogleId(googleId: string): Promise<User | null> {
    return await this.userRepository.findOne({ where: { googleId } });
  }

  async findById(id: string): Promise<User | null> {
    return await this.userRepository.findOne({ where: { id } });
  }

  async create(userData: Partial<User>): Promise<User> {
    const user = this.userRepository.create(userData);
    return await this.userRepository.save(user);
  }

  async update(id: string, userData: Partial<User>): Promise<User | null> {
    await this.userRepository.update(id, userData);
    return await this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.userRepository.delete(id);
    return result.affected !== 0;
  }

  async findByEmailVerificationToken(token: string): Promise<User | null> {
    return await this.userRepository.findOne({ where: { emailVerificationToken: token } });
  }

  async findByPasswordResetToken(token: string): Promise<User | null> {
    return await this.userRepository.findOne({ 
      where: { passwordResetToken: token },
      // Add condition to check if token is not expired
    });
  }

  async findUsersByProvider(provider: AuthProvider): Promise<User[]> {
    return await this.userRepository.find({ where: { authProvider: provider } });
  }

  async updateEmailVerification(userId: string, isVerified: boolean): Promise<User | null> {
    return await this.update(userId, { 
      isEmailVerified: isVerified,
      emailVerificationToken: isVerified ? undefined : undefined
    });
  }

  async updatePasswordResetToken(userId: string, token: string, expiresAt: Date): Promise<User | null> {
    return await this.update(userId, {
      passwordResetToken: token,
      passwordResetExpires: expiresAt
    });
  }

  async clearPasswordResetToken(userId: string): Promise<User | null> {
    return await this.update(userId, {
      passwordResetToken: undefined,
      passwordResetExpires: undefined
    });
  }
}
