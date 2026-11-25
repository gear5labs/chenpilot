import { describe, expect, it } from "@jest/globals";
import {
  formatHelpMessage,
  searchFeatures,
} from "../services/helpProvider";

describe("abuse report help entry", () => {
  it("makes the private report command discoverable on Discord and Telegram", () => {
    const feature = searchFeatures("abuse report");
    expect(feature).toHaveLength(1);
    expect(formatHelpMessage(feature, true, "markdown")).toContain(
      "(/abuse-report)"
    );
    expect(formatHelpMessage(feature, true, "html")).toContain(
      "(/abuse-report)"
    );
  });
});
