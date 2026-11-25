export interface PortfolioAsset {
  code: string;
  issuer?: string;
  balance: number;
  value: number | null;
}

export interface PortfolioReportData {
  address?: string;
  currency: string;
  totalValue: number | null;
  assets: PortfolioAsset[];
  fetchedAt?: string;
}

export class InvalidPortfolioPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPortfolioPageError";
  }
}

export function formatPortfolioPage(
  data: PortfolioReportData,
  requestedPage = 1,
  maxLength = 2_000
): string {
  if (!Number.isInteger(requestedPage) || requestedPage < 1) {
    throw new InvalidPortfolioPageError("Page must be a positive whole number.");
  }
  if (!Number.isInteger(maxLength) || maxLength < 100) {
    throw new InvalidPortfolioPageError("Message limit is too small to format a report.");
  }

  const totalValue =
    data.totalValue !== null
      ? `${data.totalValue.toFixed(4)} ${data.currency}`
      : "price data unavailable";
  const heading = data.address
    ? `💼 Stellar Portfolio Summary\n` +
      `📬 Account: ${data.address.slice(0, 4)}...${data.address.slice(-4)}\n` +
      `💰 Net Worth: ${totalValue}\n` +
      `🕐 ${data.fetchedAt ? new Date(data.fetchedAt).toUTCString() : "time unavailable"}\n\n` +
      "Assets\n"
    : `📊 **Portfolio Report (${data.currency})**\n\n` +
      `**Total Value:** ${totalValue}\n\n`;
  const assetLines = data.assets.map((asset) => {
    const value =
      asset.value === null
        ? ""
        : ` ≈ ${asset.value.toFixed(4)} ${data.currency}`;
    if (data.address) {
      const issuer = asset.issuer ? ` (${asset.issuer.slice(0, 6)}...)` : "";
      return `• ${asset.code}${issuer}: ${asset.balance.toFixed(7)}${value}\n`;
    }
    return `• **${asset.code}**: ${asset.balance}${value}\n`;
  });
  const emptyAssets =
    data.assets.length === 0 && data.address
      ? "No assets found on this account.\n"
      : "";
  const tip = data.address
    ? "\nTip: use /currency <USD|XLM|BTC> to change currency."
    : "";
  const singlePage = heading + (assetLines.join("") || emptyAssets) + tip;

  if (singlePage.length <= maxLength) {
    if (requestedPage !== 1) {
      throw new InvalidPortfolioPageError(
        "This portfolio has only one page; request page 1."
      );
    }
    return singlePage;
  }

  const pageCountDigits = String(Math.max(data.assets.length, 1)).length;
  const largestPageNumber = "9".repeat(pageCountDigits);
  const largestFooter =
    `\nPage ${largestPageNumber}/${largestPageNumber}. ` +
    `Run /report page:${largestPageNumber} to view another page.`;
  const multiPageHeading = data.address ? heading : `${heading}**Assets**\n`;
  const multiPageSuffix = tip;
  const rowBudget =
    maxLength -
    multiPageHeading.length -
    largestFooter.length -
    multiPageSuffix.length;
  if (rowBudget <= 0) {
    throw new InvalidPortfolioPageError(
      "Message limit is too small to include portfolio pagination details."
    );
  }

  const pages: string[][] = [];
  let currentPage: string[] = [];
  let currentLength = 0;
  for (const line of assetLines) {
    if (line.length > rowBudget) {
      throw new InvalidPortfolioPageError(
        "An asset entry is too long to fit within the message limit."
      );
    }
    if (currentPage.length > 0 && currentLength + line.length > rowBudget) {
      pages.push(currentPage);
      currentPage = [];
      currentLength = 0;
    }
    currentPage.push(line);
    currentLength += line.length;
  }
  if (currentPage.length > 0) pages.push(currentPage);

  if (requestedPage > pages.length) {
    throw new InvalidPortfolioPageError(
      `Page ${requestedPage} is outside the available range (1-${pages.length}).`
    );
  }

  const pageNumber = requestedPage;
  const nextOrPrevious =
    pageNumber < pages.length
      ? pageNumber + 1
      : Math.max(1, pageNumber - 1);
  const footer =
    `\nPage ${pageNumber}/${pages.length}. ` +
    `Run /report page:${nextOrPrevious} to view another page.`;
  const content =
    `${multiPageHeading}${pages[pageNumber - 1].join("")}${footer}${multiPageSuffix}`;

  if (content.length > maxLength) {
    throw new InvalidPortfolioPageError(
      "Could not fit the requested page within the message limit."
    );
  }
  return content;
}
