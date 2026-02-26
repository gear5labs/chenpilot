/**
 * Bug Condition Exploration Test for Admin IP Whitelist Enforcement
 *
 * **Validates: Requirements 1.1, 1.2, 2.1, 2.2**
 *
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
 *
 * This test encodes the EXPECTED behavior (IP whitelist enforcement on admin routes).
 * On UNFIXED code, it will FAIL because the middleware is not applied.
 * After the fix is implemented, this test will PASS, validating the fix.
 *
 * DO NOT attempt to fix the test or the code when it fails - the failure is expected
 * and proves the bug exists.
 */

import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../../src/Gateway/api";
import { UserRole } from "../../src/Auth/roles";
import config from "../../src/config/config";
import * as fc from "fast-check";

describe("Bug Condition Exploration: Admin IP Whitelist Enforcement", () => {
  let adminToken: string;
  const originalAllowedIps = config.admin.allowedIps;

  beforeAll(async () => {
    // Generate admin JWT token (no database required for this test)
    // We're testing the middleware behavior, not the database
    // Use JWT_ACCESS_SECRET which is what the JwtService uses
    const jwtSecret =
      process.env.JWT_ACCESS_SECRET ||
      "b789aaf3a7b2f27536e4133e96ea2107b4c80a8ab15727a18ce13d7725627744";
    adminToken = jwt.sign(
      {
        userId: "test-admin-id",
        name: "test-admin",
        role: UserRole.ADMIN,
      },
      jwtSecret,
      { expiresIn: "1h" }
    );
  });

  afterAll(() => {
    // Restore original config
    config.admin.allowedIps = originalAllowedIps;
  });

  afterEach(() => {
    // Restore original config after each test
    config.admin.allowedIps = originalAllowedIps;
  });

  /**
   * Property 1: Fault Condition - IP Whitelist Not Enforced on Admin Routes
   *
   * Test Case 1: Authenticated admin from IP 203.0.113.50 with ADMIN_ALLOWED_IPS=192.168.1.0/24
   * EXPECTED ON UNFIXED CODE: Returns 200 with stats (BUG - should return 403)
   * EXPECTED ON FIXED CODE: Returns 403 with "Access denied" message
   */
  it("should deny admin access from non-whitelisted IP 203.0.113.50 when ADMIN_ALLOWED_IPS=192.168.1.0/24", async () => {
    // Configure IP whitelist
    config.admin.allowedIps = ["192.168.1.0/24"];

    const response = await request(app)
      .get("/api/admin/stats")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("X-Forwarded-For", "203.0.113.50");

    // EXPECTED: 403 on fixed code, will be 200 on unfixed code
    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe(
      "Access denied. Your IP is not allowed to access this resource."
    );
  });

  /**
   * Test Case 2: Authenticated admin from IP 10.0.0.5 with ADMIN_ALLOWED_IPS=127.0.0.1,::1
   * EXPECTED ON UNFIXED CODE: Returns 200 with stats (BUG - should return 403)
   * EXPECTED ON FIXED CODE: Returns 403 with "Access denied" message
   */
  it("should deny admin access from non-whitelisted IP 10.0.0.5 when ADMIN_ALLOWED_IPS=127.0.0.1,::1", async () => {
    // Configure IP whitelist
    config.admin.allowedIps = ["127.0.0.1", "::1"];

    const response = await request(app)
      .get("/api/admin/stats")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("X-Forwarded-For", "10.0.0.5");

    // EXPECTED: 403 on fixed code, will be 200 on unfixed code
    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe(
      "Access denied. Your IP is not allowed to access this resource."
    );
  });

  /**
   * Test Case 3: Authenticated admin from IPv6 2001:db8::1 with ADMIN_ALLOWED_IPS=::1
   * EXPECTED ON UNFIXED CODE: Returns 200 with stats (BUG - should return 403)
   * EXPECTED ON FIXED CODE: Returns 403 with "Access denied" message
   */
  it("should deny admin access from non-whitelisted IPv6 2001:db8::1 when ADMIN_ALLOWED_IPS=::1", async () => {
    // Configure IP whitelist
    config.admin.allowedIps = ["::1"];

    const response = await request(app)
      .get("/api/admin/stats")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("X-Forwarded-For", "2001:db8::1");

    // EXPECTED: 403 on fixed code, will be 200 on unfixed code
    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe(
      "Access denied. Your IP is not allowed to access this resource."
    );
  });

  /**
   * Test Case 4: Authenticated admin with X-Forwarded-For containing non-whitelisted IP
   * EXPECTED ON UNFIXED CODE: Returns 200 with stats (BUG - should return 403)
   * EXPECTED ON FIXED CODE: Returns 403 with "Access denied" message
   */
  it("should deny admin access when X-Forwarded-For contains non-whitelisted IP", async () => {
    // Configure IP whitelist
    config.admin.allowedIps = ["192.168.1.0/24"];

    // X-Forwarded-For with multiple IPs (first one should be checked)
    const response = await request(app)
      .get("/api/admin/stats")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("X-Forwarded-For", "203.0.113.100, 192.168.1.50");

    // EXPECTED: 403 on fixed code, will be 200 on unfixed code
    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe(
      "Access denied. Your IP is not allowed to access this resource."
    );
  });

  /**
   * Property-Based Test: Scoped PBT for Non-Whitelisted IPs
   *
   * Generates random non-whitelisted IPs and verifies they are all denied access
   * when ADMIN_ALLOWED_IPS is configured.
   */
  it("should deny admin access from any non-whitelisted IP (property-based)", async () => {
    // Configure IP whitelist to a specific range
    config.admin.allowedIps = ["192.168.1.0/24"];

    // Generate IPs that are NOT in the 192.168.1.0/24 range
    const nonWhitelistedIpArbitrary = fc.oneof(
      // IPs in different private ranges
      fc
        .tuple(fc.constant(10), fc.nat(255), fc.nat(255), fc.nat(255))
        .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
      fc
        .tuple(
          fc.constant(172),
          fc.integer({ min: 16, max: 31 }),
          fc.nat(255),
          fc.nat(255)
        )
        .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
      // IPs in 192.168.x.x but NOT 192.168.1.x
      fc
        .tuple(
          fc.constant(192),
          fc.constant(168),
          fc.integer({ min: 2, max: 255 }),
          fc.nat(255)
        )
        .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
      // Public IPs
      fc
        .tuple(
          fc.integer({ min: 1, max: 223 }),
          fc.nat(255),
          fc.nat(255),
          fc.nat(255)
        )
        .filter(([a]) => a !== 10 && a !== 172 && a !== 192)
        .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`)
    );

    await fc.assert(
      fc.asyncProperty(nonWhitelistedIpArbitrary, async (ip) => {
        const response = await request(app)
          .get("/api/admin/stats")
          .set("Authorization", `Bearer ${adminToken}`)
          .set("X-Forwarded-For", ip);

        // EXPECTED: 403 on fixed code, will be 200 on unfixed code
        expect(response.status).toBe(403);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toBe(
          "Access denied. Your IP is not allowed to access this resource."
        );
      }),
      { numRuns: 20 } // Run 20 random test cases
    );
  });
});
