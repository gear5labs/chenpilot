export enum UserRole {
  ADMIN = "admin",
  MODERATOR = "moderator",
  USER = "user",
}

export const RoleHierarchy: Record<UserRole, number> = {
  [UserRole.ADMIN]: 3,
  [UserRole.MODERATOR]: 2,
  [UserRole.USER]: 1,
};

export function hasRequiredRole(
  userRole: UserRole,
  requiredRole: UserRole
): boolean {
  return RoleHierarchy[userRole] >= RoleHierarchy[requiredRole];
}
