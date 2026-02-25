import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../../src/Gateway/api";
import AppDataSource from "../../src/config/Datasource";
import { User } from "../../src/Auth/user.entity";
import config from "../../src/config/config";

describe("Auth - Password Reset & Email Verification", () => {
  let testUser: User;

  beforeAll(async () => {
    const userRepository = AppDataSource.getRepository(User);

    // Create a test user with an email
    testUser = userRepository.create({
      name: "authtestuser",
      email: "authtest@example.com",
      address: "GTEST000000000000000000000000000000000000000000000000000",
      pk: "STEST000000000000000000000000000000000000000000000000000",
      encryptedPrivateKey: "test-encrypted-key",
    });
    testUser = await userRepository.save(testUser);
  });

  afterAll(async () => {
    const userRepository = AppDataSource.getRepository(User);
    await userRepository.delete({ name: "authtestuser" });
  });

  // ─── POST /auth/forgot-password ─────────────────────────────────

  describe("POST /auth/forgot-password", () => {
    it("should return success for valid email", async () => {
      const response = await request(app)
        .post("/auth/forgot-password")
        .send({ email: "authtest@example.com" })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain("reset link has been sent");
    });

    it("should return same message for non-existent email (prevent enumeration)", async () => {
      const response = await request(app)
        .post("/auth/forgot-password")
        .send({ email: "nonexistent@example.com" })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain("reset link has been sent");
    });

    it("should return 400 when email is missing", async () => {
      const response = await request(app)
        .post("/auth/forgot-password")
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it("should return 400 for invalid email format", async () => {
      const response = await request(app)
        .post("/auth/forgot-password")
        .send({ email: "not-an-email" })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  // ─── POST /auth/reset-password ──────────────────────────────────

  describe("POST /auth/reset-password", () => {
    it("should return 400 when token is missing", async () => {
      const response = await request(app)
        .post("/auth/reset-password")
        .send({ newPassword: "newpassword123" })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it("should return 400 when newPassword is missing", async () => {
      const response = await request(app)
        .post("/auth/reset-password")
        .send({ token: "some-token" })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it("should return 401 for invalid token", async () => {
      const response = await request(app)
        .post("/auth/reset-password")
        .send({ token: "invalid-token", newPassword: "newpassword123" })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it("should return 400 for password shorter than 8 characters", async () => {
      const validToken = jwt.sign(
        {
          userId: testUser.id,
          email: testUser.email,
          type: "password_reset",
        },
        config.jwt.secret,
        { expiresIn: "1h" }
      );

      const response = await request(app)
        .post("/auth/reset-password")
        .send({ token: validToken, newPassword: "short" })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it("should reject token with wrong type", async () => {
      const wrongTypeToken = jwt.sign(
        {
          userId: testUser.id,
          email: testUser.email,
          type: "email_verification",
        },
        config.jwt.secret,
        { expiresIn: "1h" }
      );

      const response = await request(app)
        .post("/auth/reset-password")
        .send({ token: wrongTypeToken, newPassword: "newpassword123" })
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  // ─── POST /auth/verify-email ────────────────────────────────────

  describe("POST /auth/verify-email", () => {
    it("should return 400 when token is missing", async () => {
      const response = await request(app)
        .post("/auth/verify-email")
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it("should return 401 for invalid token", async () => {
      const response = await request(app)
        .post("/auth/verify-email")
        .send({ token: "invalid-token" })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it("should verify email with valid token", async () => {
      const validToken = jwt.sign(
        {
          userId: testUser.id,
          email: testUser.email,
          type: "email_verification",
        },
        config.jwt.secret,
        { expiresIn: "24h" }
      );

      const response = await request(app)
        .post("/auth/verify-email")
        .send({ token: validToken })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain("verified");
    });

    it("should return already verified for re-verification", async () => {
      const validToken = jwt.sign(
        {
          userId: testUser.id,
          email: testUser.email,
          type: "email_verification",
        },
        config.jwt.secret,
        { expiresIn: "24h" }
      );

      const response = await request(app)
        .post("/auth/verify-email")
        .send({ token: validToken })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain("already verified");
    });

    it("should reject token with wrong type", async () => {
      const wrongTypeToken = jwt.sign(
        {
          userId: testUser.id,
          email: testUser.email,
          type: "password_reset",
        },
        config.jwt.secret,
        { expiresIn: "1h" }
      );

      const response = await request(app)
        .post("/auth/verify-email")
        .send({ token: wrongTypeToken })
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  // ─── GET /auth/verify-email ─────────────────────────────────────

  describe("GET /auth/verify-email", () => {
    it("should return 400 when token query param is missing", async () => {
      const response = await request(app).get("/auth/verify-email").expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  // ─── POST /auth/send-verification ───────────────────────────────

  describe("POST /auth/send-verification", () => {
    it("should return 400 when userId is missing", async () => {
      const response = await request(app)
        .post("/auth/send-verification")
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it("should return 404 for non-existent user", async () => {
      const response = await request(app)
        .post("/auth/send-verification")
        .send({ userId: "00000000-0000-0000-0000-000000000000" })
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });
});
