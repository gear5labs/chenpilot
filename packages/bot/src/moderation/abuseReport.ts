export type AbuseReportPlatform = "discord" | "telegram";

export interface AbuseReport {
  platform: AbuseReportPlatform;
  reporterId: string;
  command: string;
  details: string;
  reportedUserId?: string;
}

const MAX_COMMAND_LENGTH = 100;
const MAX_DETAILS_LENGTH = 1_000;
const MAX_USER_ID_LENGTH = 100;

function cleanField(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

export function validateAbuseReport(report: AbuseReport): string | undefined {
  if (!report.reporterId.trim()) return "Reporter identity is required.";
  if (!cleanField(report.command)) return "A command name is required.";
  if (cleanField(report.command).length > MAX_COMMAND_LENGTH) {
    return `Command name must be at most ${MAX_COMMAND_LENGTH} characters.`;
  }
  if (!cleanField(report.details)) return "Report details are required.";
  if (cleanField(report.details).length > MAX_DETAILS_LENGTH) {
    return `Report details must be at most ${MAX_DETAILS_LENGTH} characters.`;
  }
  if (
    report.reportedUserId &&
    cleanField(report.reportedUserId).length > MAX_USER_ID_LENGTH
  ) {
    return `Reported user ID must be at most ${MAX_USER_ID_LENGTH} characters.`;
  }
  return undefined;
}

export function formatAbuseReport(report: AbuseReport): string {
  const validationError = validateAbuseReport(report);
  if (validationError) throw new Error(validationError);

  const lines = [
    "ABUSE REPORT",
    `Platform: ${report.platform}`,
    `Reporter ID: ${cleanField(report.reporterId)}`,
    `Command: ${cleanField(report.command)}`,
    `Reported user ID: ${
      report.reportedUserId ? cleanField(report.reportedUserId) : "not provided"
    }`,
    `Details: ${cleanField(report.details)}`,
  ];
  return lines.join("\n");
}

export async function submitAbuseReport(
  report: AbuseReport,
  sendToModerators: (message: string) => Promise<void>
): Promise<void> {
  await sendToModerators(formatAbuseReport(report));
}
