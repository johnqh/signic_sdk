// ============================================================
// Public types (exported via index.ts)
// ============================================================

/**
 * Configuration for creating a {@link SignicClient} instance.
 *
 * @example
 * ```ts
 * const client = new SignicClient({
 *   privateKey: '0xac09...',
 *   indexerUrl: 'https://api.signic.email/idx',
 *   wildduckUrl: 'https://api.signic.email/api',
 * });
 * ```
 */
export interface SignicClientConfig {
  /** EVM private key (hex string starting with 0x) */
  privateKey: `0x${string}`;
  /** Indexer API base URL (e.g. "https://api.signic.email/idx") */
  indexerUrl: string;
  /** WildDuck API base URL (e.g. "https://api.signic.email/api") */
  wildduckUrl: string;
  /** Email domain (default: 'signic.email'). Also used as the SIWE domain. */
  emailDomain?: string;
  /** EVM chain ID for the SIWE message (default: 1 = Ethereum mainnet) */
  chainId?: number;
}

/** An email address with an optional display name. */
export interface SignicEmailAddress {
  /** Email address string (e.g. "0xabc...@signic.email") */
  address: string;
  /** Display name (may be empty string) */
  name: string;
}

/**
 * Summary representation of an email, returned by {@link SignicClient.getUnreadEmails}.
 * Contains metadata only — use {@link SignicClient.getEmail} for the full body.
 */
export interface SignicEmail {
  /** WildDuck message UID */
  id: number;
  /** Mailbox ID this message belongs to */
  mailboxId: string;
  /** Sender address */
  from: SignicEmailAddress;
  /** Recipient addresses */
  to: SignicEmailAddress[];
  /** Email subject line */
  subject: string;
  /** ISO 8601 date from the Date header */
  date: string;
  /** Short preview of the message body (first ~128 chars) */
  intro: string;
  /** Whether the message has been read */
  seen: boolean;
  /** Whether the message has file attachments */
  hasAttachments: boolean;
}

/** Result from {@link SignicClient.getUnreadEmails}. */
export interface UnreadEmailsResult {
  /** Array of unread email summaries */
  emails: SignicEmail[];
  /** Total number of unread emails in the mailbox (may exceed array length if limited) */
  total: number;
}

/** Result from {@link SignicClient.markAsRead}. */
export interface MarkAsReadResult {
  /** Whether the update succeeded */
  success: boolean;
  /** Number of messages updated (typically 1) */
  updated: number;
}

/** Metadata for a single email attachment. */
export interface SignicEmailAttachment {
  /** WildDuck attachment ID (use for download URLs) */
  id: string;
  /** SHA-256 hash of the attachment content (hex) */
  hash: string;
  /** Original filename */
  filename: string;
  /** MIME type (e.g. "application/pdf") */
  contentType: string;
  /** Content-Disposition value (e.g. "attachment", "inline") */
  disposition: string;
  /** Transfer encoding used (content is already decoded) */
  transferEncoding: string;
  /** True if this is an inline/embedded image from multipart/related */
  related: boolean;
  /** Approximate size in kilobytes */
  sizeKb: number;
}

/**
 * Full email detail, returned by {@link SignicClient.getEmail}.
 * Includes the complete body (HTML + text), all recipients, flags, and attachments.
 */
export interface SignicEmailDetail {
  /** WildDuck message UID */
  id: number;
  /** Mailbox ID this message belongs to */
  mailboxId: string;
  /** Conversation thread ID */
  thread: string;
  /** Sender address */
  from: SignicEmailAddress;
  /** Reply-To address, if set */
  replyTo?: SignicEmailAddress;
  /** To recipients */
  to: SignicEmailAddress[];
  /** CC recipients */
  cc: SignicEmailAddress[];
  /** BCC recipients (usually only visible in drafts/sent) */
  bcc: SignicEmailAddress[];
  /** Email subject line */
  subject: string;
  /** Message-ID header value */
  messageId: string;
  /** ISO 8601 date from the Date header */
  date: string;
  /** ISO 8601 date when the server received the message */
  idate: string;
  /** Message size in bytes */
  size: number;
  /** Whether the message has been read (\\Seen flag) */
  seen: boolean;
  /** Whether the message is starred (\\Flagged flag) */
  flagged: boolean;
  /** Whether the message is marked for deletion (\\Deleted flag) */
  deleted: boolean;
  /** Whether this is a draft (\\Draft flag) */
  draft: boolean;
  /** Whether the message has been replied to (\\Answered flag) */
  answered: boolean;
  /** Whether the message has been forwarded ($Forwarded flag) */
  forwarded: boolean;
  /** HTML body parts (one string per MIME part, most messages have one) */
  html: string[];
  /** Plain text body */
  text: string;
  /** File attachments with metadata */
  attachments: SignicEmailAttachment[];
  /** Email authentication verification results (TLS, SPF, DKIM) */
  verificationResults?: {
    tls: { name: string; version: string } | false;
    spf: Record<string, unknown> | false;
    dkim: Record<string, unknown> | false;
  };
}

// ============================================================
// Internal types (API response shapes, not exported via index)
// ============================================================

/** Stored after a successful connect() call. */
export interface SignicAuthState {
  userId: string;
  accessToken: string;
  username: string;
  inboxMailboxId: string;
}

// --- Indexer API types ---

/** Generic wrapper for all Indexer API JSON responses. */
export interface IndexerResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

/** Payload from GET /wallets/{address}/message — contains the SIWE message to sign. */
export interface IndexerSignInMessageData {
  walletAddress: string;
  chainType: string;
  message: string;
  chainId?: number;
}

/** A single wallet account entry from the Indexer. */
export interface IndexerWalletAccount {
  walletAddress: string;
  chainType: string;
  names: Array<{ name: string; entitled: boolean }>;
}

/** Payload from GET /wallets/{address}/accounts. */
export interface IndexerEmailAccountsResult {
  accounts: IndexerWalletAccount[];
}

// --- WildDuck API types ---

/** Response from POST /authenticate. */
export interface WildduckAuthResponse {
  success: boolean;
  id?: string;
  username?: string;
  address?: string;
  scope?: string;
  token?: string;
  error?: string;
  code?: string;
  message?: string;
}

/** A single mailbox entry from GET /users/{id}/mailboxes. */
export interface WildduckMailboxItem {
  id: string;
  name: string;
  path: string;
  specialUse?: string;
  modifyIndex: number;
  subscribed: boolean;
  hidden: boolean;
  total?: number;
  unseen?: number;
}

/** Response from GET /users/{id}/mailboxes. */
export interface WildduckMailboxResponse {
  success: boolean;
  results: WildduckMailboxItem[];
  error?: string;
}

/** Address object used in WildDuck message responses. */
export interface WildduckMessageAddress {
  address: string;
  name: string;
}

/** A message item from the list endpoint (GET .../messages?...). */
export interface WildduckMessageListItem {
  id: number;
  mailbox: string;
  thread: string;
  from?: WildduckMessageAddress;
  to: WildduckMessageAddress[];
  subject: string;
  date: string;
  intro: string;
  attachments: boolean;
  seen: boolean;
  flagged: boolean;
  size: number;
}

/** Response from GET /users/{id}/mailboxes/{mailbox}/messages (list). */
export interface WildduckMessagesResponse {
  success: boolean;
  total: number;
  page: number;
  previousCursor: string | false;
  nextCursor: string | false;
  results: WildduckMessageListItem[];
  error?: string;
}

/** Response from PUT /users/{id}/mailboxes/{mailbox}/messages/{message}. */
export interface WildduckUpdateMessageResponse {
  success: boolean;
  updated?: number;
  error?: string;
}

/** Response from GET /users/{id}/mailboxes/{mailbox}/messages/{message} (single message detail). */
export interface WildduckMessageDetailResponse {
  success: boolean;
  id: number;
  mailbox: string;
  user: string;
  thread: string;
  from?: WildduckMessageAddress;
  replyTo?: WildduckMessageAddress;
  to: WildduckMessageAddress[];
  cc: WildduckMessageAddress[];
  bcc: WildduckMessageAddress[];
  subject: string;
  messageId: string;
  date: string;
  idate: string;
  size: number;
  seen: boolean;
  flagged: boolean;
  deleted: boolean;
  draft: boolean;
  answered: boolean;
  forwarded: boolean;
  html: string[];
  text: string;
  attachments: Array<{
    id: string;
    hash: string;
    filename: string;
    contentType: string;
    disposition: string;
    transferEncoding: string;
    related: boolean;
    sizeKb: number;
  }>;
  verificationResults?: {
    tls: { name: string; version: string } | false;
    spf: Record<string, unknown> | false;
    dkim: Record<string, unknown> | false;
  };
  error?: string;
}
