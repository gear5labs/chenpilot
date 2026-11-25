# Bot Command Output and Selectors

## Portfolio reports

`/report` still shows the whole portfolio in one response when the formatted
output fits. For larger portfolios, the bot groups complete asset entries into
pages that stay within the platform's message limit (2,000 characters for the
Discord slash-command response; 4,096 for callers of the shared handler).

Use the optional `page` integer on `/report` to request a specific page. Page 1
is the default. The legacy `!report <page>` path, where enabled, uses the same
pagination. Multi-page responses show the current page and a command hint for
the next page (or the previous page on the last page). Empty portfolios remain
a single response. Page numbers below 1, beyond the available page count, and
individual entries too long to fit are rejected with an explicit error; the bot
does not silently drop asset rows. Existing short reports keep their
single-message layout.

## Accessible asset choices

Swap wizard asset buttons include the action and asset in each visible button
name, for example “Sell XLM asset” and “Buy USDC asset”. The descriptive button
text is the text alternative exposed to assistive technologies; callback values
and workflow transitions are unchanged.

There is no network-selection control in the current bot workflows. The
accessibility change therefore applies to existing asset buttons only and does
not add or imply network selection behavior.
