# Recurring Payment Confirmation Summaries (#1102)

A recurring payment (`PaymentMandate`) with `approvalRequired: true` only runs
after the user confirms a summary of exactly what will happen.

## Summary contents

`RecurringPaymentMandateService.getConfirmationSummary(id)` returns:

| Field | Meaning |
|---|---|
| `recipient`, `network`, `asset` | Who is paid, on which network, in which asset |
| `amount` | Amount per run |
| `cadence` | `intervalMs` plus a plain description, e.g. `"every week"` |
| `nextRunAt` | ISO time of the next run |
| `cumulativeLimit` | Maximum total spend |
| `cancellationPolicy` | Revocable at any time. Cancelling stops all future runs immediately, and a run already processing is not reversed. Also gives the missed-run behaviour (skipped, or executed late once). |
| `missingFields` | Required fields that are missing or invalid |
| `summaryHash` | Hash of all of the above |

## Previewing Edits

`RecurringPaymentMandateService.previewMandateUpdate(id, changes)` allows callers to inspect the projected next execution amount, timing, and confirmation summary prior to committing any change.

## Rules

- **Activation:** `approveMandate(id, summaryHash, actor)` succeeds only if
  `summaryHash` matches the current summary. Otherwise it throws
  `MandateConfirmationError` with reason `stale_summary`. It throws reason
  `missing_fields` while `missingFields` is non-empty.
- **Any change invalidates the confirmation:** `updateMandate(id, changes)`
  clears it. Fields covered are recipient, amount, asset, network, cadence,
  next run, limit and missed-run behaviour. The mandate must be confirmed
  again from a fresh summary before it runs.
- **Runtime check:** each run also verifies that the confirmed payment terms
  still match (`reason: stale_summary`). The next run time is excluded from
  this check because it advances after every run.
- **Unconfirmed mandates:** running one throws `reason: not_confirmed`.

**Breaking change:** `approveMandate(id)` now requires the `summaryHash` of the
summary shown to the user.

Tests: `src/Payments/__tests__/mandateConfirmation.test.ts` and `src/Payments/__tests__/mandatePreview.test.ts`.
