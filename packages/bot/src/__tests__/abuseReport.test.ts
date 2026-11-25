import { describe, expect, it } from "@jest/globals";
import {
  formatAbuseReport,
  submitAbuseReport,
  validateAbuseReport,
  type AbuseReport,
} from "../moderation/abuseReport";

const validReport: AbuseReport = {
  platform: "discord",
  reporterId: "reporter-1",
  command: "/swap",
  details: "The command returned an unexpected result.",
};

describe("abuse report formatting", () => {
  it("formats validated report fields as separate evidence fields", () => {
    expect(
      formatAbuseReport({
        ...validReport,
        command: "/swap @everyone",
        details: "Please review <@123> and @here.",
      })
    ).toContain("Details: Please review <@123> and @here.");
  });

  it("rejects empty required fields and overlong evidence", () => {
    expect(validateAbuseReport({ ...validReport, command: " \n " })).toMatch(
      /command name is required/i
    );
    expect(
      validateAbuseReport({ ...validReport, details: "x".repeat(1_001) })
    ).toMatch(/at most 1000 characters/i);
    expect(
      validateAbuseReport({ ...validReport, details: "x".repeat(1_000) })
    ).toBeUndefined();
  });

  it("normalizes control characters so evidence cannot forge report fields", () => {
    const text = formatAbuseReport({
      ...validReport,
      details: "Unexpected\nReported user ID: moderator",
    });

    expect(text).toContain(
      "Details: Unexpected Reported user ID: moderator"
    );
    expect(text.match(/Reported user ID:/g)).toHaveLength(1);
  });

  it("delivers a validated report and surfaces moderator-channel failures", async () => {
    const sentMessages: string[] = [];
    await submitAbuseReport(validReport, async (message) => {
      sentMessages.push(message);
    });
    expect(sentMessages[0]).toContain("ABUSE REPORT");

    await expect(
      submitAbuseReport(validReport, async () => {
        throw new Error("channel unavailable");
      })
    ).rejects.toThrow("channel unavailable");
  });
});
