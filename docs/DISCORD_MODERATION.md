# Discord Scam Detection

The bot includes an automated scam-link detection system for Discord public channels. It scans every message sent in monitored channels and takes a configurable action when a suspicious link is found.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_SCAM_DETECTION_ENABLED` | `true` | Master toggle. Set to `false` to disable all scanning. |
| `DISCORD_SCAM_DETECTION_ACTION` | `flag` | Action when a scam link is detected. See [Supported Actions](#supported-actions). |
| `DISCORD_SCAM_DETECTION_CHANNELS` | _(empty)_ | Comma-separated Discord channel IDs to monitor. When empty, **all public channels** are monitored. DMs are never scanned. |

## Supported Actions

| Value | Behavior |
|-------|----------|
| `flag` (default) | The bot replies to the offending message with a warning explaining why it was flagged. The original message remains visible. |
| `block` | The bot deletes the offending message and posts a warning as a new channel message (not a reply). The original content is removed. |

Both actions log a `SCAM_LINK_DETECTED` entry to the audit log channel (if configured).

## Detection Triggers

A message is flagged as a potential scam when at least **one** of the following conditions is met:

### 1. Suspicious Top-Level Domains
URLs ending with TLDs commonly abused in phishing campaigns: `.xyz`, `.top`, `.zip`, `.mov`, `.tk`, `.ml`, `.ga`, `.cf`, `.gq`, `.pw`, `.cc`, `.men`, `.date`, `.loan`, `.win`, `.review`, `.trade`.

### 2. Typosquatting
Domains that mimic well-known services:

| Targeted Domain | Examples |
|-----------------|----------|
| `stellar.org` | `stellaar.org`, `stelllar.org`, `stelar.org`, `stellr.org`, `stllar.org`, `stellarr.org` |
| `discord.com` | `d1scord.com`, `disc0rd.com`, `discrod.com`, `diiscord.com` |
| `github.com` | `githuub.com`, `githhub.com`, `githab.com`, `gitthub.com` |

### 3. Scam Keywords
The URL path contains at least **two** of the following keywords: `free`, `bonus`, `giveaway`, `airdrop`, `claim`, `reward`, `double`, `multiply`, `invest`, `profit`, `earn`, `crypto`, `bitcoin`, `ethereum`, `stellar`, `xlm`, `wallet`, `connect`, `verify`, `confirm`, `urgent`, `limited`, `exclusive`, `secret`.

### 4. Suspicious URL Patterns
- More than 3 subdomains
- Random-looking strings of 32+ characters
- Percent-encoded characters (obfuscation)

### 5. IP-Address Domains
URLs that use a raw IPv4 address instead of a domain name.

### 6. Invalid or Obfuscated URLs
URLs that cannot be parsed by the standard URL parser.

## Whitelist

The following domains (and their subdomains) are always allowed and never trigger detection:

`stellar.org`, `discord.com`, `discord.gg`, `github.com`, `reddit.com`, `twitter.com`, `x.com`, `medium.com`

The `ScamDetectionService` exposes `addToWhitelist()` and `removeFromWhitelist()` methods, but these are not currently exposed through any runtime command or admin interface.

## Channel Scoping

- DMs are never scanned.
- If `DISCORD_SCAM_DETECTION_CHANNELS` is empty (default), all public guild channels are monitored.
- If one or more channel IDs are listed, **only** those specific channels are scanned. Channel IDs are separated by commas.

## False-Positive Mitigation

There is **no admin review queue or appeal mechanism** in the current implementation. The only built-in mitigations are:

- **Whitelist** — known-safe domains are never flagged.
- **Channel scoping** — scanning can be restricted to specific channels to avoid noise in high-traffic areas.
- **Keyword threshold** — scam keywords require at least 2 matches, reducing single-word false positives.

## Audit Logging

All detections are recorded via `logAuditAction()` with:
- Action type: `SCAM_LINK_DETECTED`
- User ID of the message author
- Detection reason and matched pattern
- Action taken (`flag` or `block`)
- Timestamp

## User Abuse Reports

Users can report misuse of a bot command without posting evidence in a public
channel:

- **Discord:** Use `/abuse-report` with the command involved and up to 1,000
  characters of details. A reported user ID is optional. The acknowledgement is
  private; evidence is forwarded only to the moderator channel and is not
  echoed into the originating channel.
- **Telegram:** Use `/abuse-report <command> | <what happened>` in a private
  chat with the bot. Group submissions are rejected without forwarding their
  details.

Configure a dedicated, moderator-restricted destination before enabling reports:

| Variable | Description |
|----------|-------------|
| `MODERATION_LOG_CHANNEL_ID` | Discord channel that receives user abuse reports |
| `MODERATION_LOG_CHAT_ID` | Telegram chat that receives user abuse reports |

These settings intentionally do not fall back to general audit channels. The
Discord destination must be a guild text channel that is not visible to
`@everyone`; configure role access so only moderators can view it. If a
destination is missing, invalid, public, or the bot cannot send to it, the user
receives an explicit failure response and the report is not acknowledged as submitted.
Reports are delivered as plain text with platform mentions disabled where
supported; they are not stored in a separate database. Access and retention are
therefore governed by the configured moderator destination's permissions and
history settings. Do not include passwords, recovery phrases, or secret keys.

The report command is separate from `/report`, which continues to return a
portfolio. Submissions are rate-limited through the existing strict command
limiter.
