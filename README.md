# @sudobility/signic_sdk

TypeScript/JavaScript SDK for the [Signic](https://signic.email) decentralized email platform. Authenticate with an Ethereum wallet via SIWE (Sign-In with Ethereum) and read emails from a WildDuck mail server.

## Installation

```bash
npm install @sudobility/signic_sdk
# or
bun add @sudobility/signic_sdk
```

**Requirements:** Node.js >= 20.0.0

## Quick Start

```typescript
import { SignicClient } from '@sudobility/signic_sdk';

const client = new SignicClient({
  privateKey: '0xac09...',
  indexerUrl: 'https://api.signic.email/idx',
  wildduckUrl: 'https://api.signic.email/api',
});

// Derive addresses (no auth needed)
console.log(client.getAddress());      // "0xf39F..."
console.log(client.getEmailAddress()); // "0xf39F...@signic.email"

// Authenticate via SIWE
await client.connect();

// Fetch unread emails
const { emails, total } = await client.getUnreadEmails(10);
console.log(`${total} unread emails`);

// Get full email content
const full = await client.getEmail(emails[0].id);
console.log(full.subject, full.text);

// Mark as read
await client.markAsRead(emails[0].id);
```

## API Reference

### `new SignicClient(config)`

Create a new client instance.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `privateKey` | `` `0x${string}` `` | Yes | EVM private key (hex with 0x prefix) |
| `indexerUrl` | `string` | Yes | Indexer API base URL |
| `wildduckUrl` | `string` | Yes | WildDuck API base URL |
| `emailDomain` | `string` | No | Email domain (default: `signic.email`) |
| `chainId` | `number` | No | EVM chain ID for SIWE (default: `1`) |

### Methods

#### `getAddress(): string`

Returns the EVM wallet address derived from the private key. Does not require authentication.

#### `getEmailAddress(): string`

Returns the Signic email address (e.g. `0xabc...@signic.email`). Does not require authentication.

#### `isConnected(): boolean`

Returns `true` if `connect()` has completed successfully.

#### `connect(): Promise<void>`

Authenticate with the Signic platform via SIWE. Must be called before any email methods.

Performs a 6-step flow:
1. Fetch a SIWE message from the Indexer
2. Sign the message with the wallet's private key
3. Convert the signature to base64
4. Verify the signature with the Indexer
5. Authenticate with WildDuck to get an access token
6. Locate the INBOX mailbox

**Throws:** `SignicAuthError` on auth failure, `SignicNetworkError` on network failure.

#### `getUnreadEmails(limit?: number): Promise<UnreadEmailsResult>`

Fetch unread emails from the inbox. Returns summary objects (use `getEmail()` for full content).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | `number` | `50` | Maximum number of emails to return |

**Returns:** `{ emails: SignicEmail[], total: number }`

#### `getEmail(emailId: number, mailboxId?: string): Promise<SignicEmailDetail>`

Fetch the complete email by ID, including HTML/text body, all recipients, attachments, and flags.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `emailId` | `number` | - | Message UID from `SignicEmail.id` |
| `mailboxId` | `string` | INBOX | Mailbox to fetch from |

**Returns:** `SignicEmailDetail` with `html`, `text`, `cc`, `bcc`, `replyTo`, `attachments`, `verificationResults`, and all message flags.

#### `markAsRead(messageId: number, mailboxId?: string): Promise<MarkAsReadResult>`

Mark a message as read (sets the `\Seen` flag).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `messageId` | `number` | - | Message UID |
| `mailboxId` | `string` | INBOX | Mailbox containing the message |

**Returns:** `{ success: boolean, updated: number }`

### Types

#### `SignicEmail`

Summary email object returned by `getUnreadEmails()`.

```typescript
interface SignicEmail {
  id: number;                   // Message UID
  mailboxId: string;            // Mailbox ID
  from: SignicEmailAddress;     // Sender
  to: SignicEmailAddress[];     // Recipients
  subject: string;              // Subject line
  date: string;                 // ISO 8601 date
  intro: string;                // Preview (~128 chars)
  seen: boolean;                // Read status
  hasAttachments: boolean;      // Has file attachments
}
```

#### `SignicEmailDetail`

Full email object returned by `getEmail()`.

```typescript
interface SignicEmailDetail {
  id: number;
  mailboxId: string;
  thread: string;                        // Conversation thread ID
  from: SignicEmailAddress;
  replyTo?: SignicEmailAddress;
  to: SignicEmailAddress[];
  cc: SignicEmailAddress[];
  bcc: SignicEmailAddress[];
  subject: string;
  messageId: string;                     // Message-ID header
  date: string;                          // Date header (ISO 8601)
  idate: string;                         // Server receive date (ISO 8601)
  size: number;                          // Size in bytes
  seen: boolean;
  flagged: boolean;
  deleted: boolean;
  draft: boolean;
  answered: boolean;
  forwarded: boolean;
  html: string[];                        // HTML body parts
  text: string;                          // Plain text body
  attachments: SignicEmailAttachment[];   // File attachments
  verificationResults?: {                // TLS, SPF, DKIM results
    tls: { name: string; version: string } | false;
    spf: Record<string, unknown> | false;
    dkim: Record<string, unknown> | false;
  };
}
```

#### `SignicEmailAttachment`

```typescript
interface SignicEmailAttachment {
  id: string;               // Attachment ID
  hash: string;             // SHA-256 hash (hex)
  filename: string;         // Original filename
  contentType: string;      // MIME type
  disposition: string;      // "attachment" or "inline"
  transferEncoding: string; // Transfer encoding
  related: boolean;         // Inline/embedded image
  sizeKb: number;           // Approximate size in KB
}
```

### Error Classes

All errors extend `SignicError` which carries `operation` and `statusCode` properties.

| Error | When |
|-------|------|
| `SignicError` | Base class for all SDK errors |
| `SignicAuthError` | Authentication failure (401/403) or calling methods before `connect()` |
| `SignicNetworkError` | Network failure (DNS, timeout, no response) |
| `SignicValidationError` | Input validation failure (400/422) |

```typescript
import { SignicError, SignicAuthError } from '@sudobility/signic_sdk';

try {
  await client.getUnreadEmails();
} catch (err) {
  if (err instanceof SignicAuthError) {
    console.error('Auth failed:', err.operation, err.statusCode);
  }
}
```

## License

BUSL-1.1
