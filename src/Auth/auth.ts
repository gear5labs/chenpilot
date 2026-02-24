import { container } from "tsyringe";
import UserService from "./user.service";
import { AuthService, authService } from "./auth.service";

export async function authenticate(userId: string): Promise<boolean> {
  if (!userId) return false;
  const userService = container.resolve(UserService);
  const user = await userService.getUserById(userId);
  return user !== null;
}

export { authService, AuthService };
