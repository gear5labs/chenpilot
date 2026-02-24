import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import AppDataSource from "../../src/config/Datasource";
import JwtService from "../../src/Auth/jwt.service";
import UserService from "../../src/Auth/user.service";
import { container } from "tsyringe";

describe("JWT Refresh Token Rotation", () => {
  let jwtService: JwtService;
  let userService: UserService;
  let testUserId: string;

  beforeAll(async () => {
    // Set test JWT secrets
    process.env.JWT_ACCESS_SECRET = "test_access_secret_min_32_characters_long";
    process.env.JWT_REFRESH_SECRET =
      "test_refresh_secret_min_32_characters_long";

    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    jwtService = container.resolve(JwtService);
    userService = container.resolve(UserService);

    // Create test user
    const user = await userService.createUser({ name: "testuser_jwt" });
    testUserId = user.id;
  });

  afterAll(async () => {
    // Cleanup
    if (testUserId) {
      await jwtService.revokeAllUserTokens(testUserId, "Test cleanup");
    }
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  it("should generate token pair", async () => {
    const tokens = await jwtService.generateTokenPair(
      testUserId,
      "testuser_jwt"
    );

    expect(tokens).toHaveProperty("accessToken");
    expect(tokens).toHaveProperty("refreshToken");
    expect(tokens).toHaveProperty("expiresIn");
    expect(tokens.expiresIn).toBe(900); // 15 minutes
  });

  it("should verify valid access token", async () => {
    const tokens = await jwtService.generateTokenPair(
      testUserId,
      "testuser_jwt"
    );
    const payload = jwtService.verifyAccessToken(tokens.accessToken);

    expect(payload.userId).toBe(testUserId);
    expect(payload.name).toBe("testuser_jwt");
  });

  it("should reject invalid access token", () => {
    expect(() => {
      jwtService.verifyAccessToken("invalid_token");
    }).toThrow("Invalid or expired access token");
  });

  it("should rotate refresh token successfully", async () => {
    const tokens1 = await jwtService.generateTokenPair(
      testUserId,
      "testuser_jwt"
    );

    // Wait a bit to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 100));

    const tokens2 = await jwtService.rotateRefreshToken(tokens1.refreshToken);

    expect(tokens2.accessToken).not.toBe(tokens1.accessToken);
    expect(tokens2.refreshToken).not.toBe(tokens1.refreshToken);
  });

  it("should reject reused refresh token", async () => {
    const tokens1 = await jwtService.generateTokenPair(
      testUserId,
      "testuser_jwt"
    );

    // Use token once
    await jwtService.rotateRefreshToken(tokens1.refreshToken);

    // Try to reuse the same token
    await expect(
      jwtService.rotateRefreshToken(tokens1.refreshToken)
    ).rejects.toThrow("Token has been revoked");
  });

  it("should revoke specific token", async () => {
    const tokens = await jwtService.generateTokenPair(
      testUserId,
      "testuser_jwt"
    );

    await jwtService.revokeToken(tokens.refreshToken, "Test revocation");

    await expect(
      jwtService.rotateRefreshToken(tokens.refreshToken)
    ).rejects.toThrow("Token has been revoked");
  });

  it("should revoke all user tokens", async () => {
    const tokens1 = await jwtService.generateTokenPair(
      testUserId,
      "testuser_jwt"
    );
    const tokens2 = await jwtService.generateTokenPair(
      testUserId,
      "testuser_jwt"
    );

    await jwtService.revokeAllUserTokens(testUserId, "Test logout all");

    await expect(
      jwtService.rotateRefreshToken(tokens1.refreshToken)
    ).rejects.toThrow();

    await expect(
      jwtService.rotateRefreshToken(tokens2.refreshToken)
    ).rejects.toThrow();
  });

  it("should list active user tokens", async () => {
    // Clean up first
    await jwtService.revokeAllUserTokens(testUserId);

    await jwtService.generateTokenPair(testUserId, "testuser_jwt");
    await jwtService.generateTokenPair(testUserId, "testuser_jwt");

    const activeTokens = await jwtService.getUserActiveTokens(testUserId);

    expect(activeTokens.length).toBe(2);
    expect(activeTokens[0].isRevoked).toBe(false);
  });

  it("should cleanup expired tokens", async () => {
    // This test would require manipulating dates or waiting
    // For now, just verify the method exists and returns a number
    const deletedCount = await jwtService.cleanupExpiredTokens();
    expect(typeof deletedCount).toBe("number");
  });
});
