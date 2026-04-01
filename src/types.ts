// ============================================================
// Public types (exported via index.ts)
// ============================================================

export interface SignicClientConfig {
  /** EVM private key (hex string starting with 0x) */
  privateKey: `0x${string}`;
  /** Indexer API base URL */
  indexerUrl: string;
  /** WildDuck API base URL */
  wildduckUrl: string;
  /** Email domain (default: 'signic.email') */
  emailDomain?: string;
  /** Chain ID for SIWE message (default: 1) */
  chainId?: number;
}

export interface SignicEmailAddress {
  address: string;
  name: string;
}

export interface SignicEmail {
  id: number;
  mailboxId: string;
  from: SignicEmailAddress;
  to: SignicEmailAddress[];
  subject: string;
  date: string;
  intro: string;
  seen: boolean;
  hasAttachments: boolean;
}

export interface UnreadEmailsResult {
  emails: SignicEmail[];
  total: number;
}

export interface MarkAsReadResult {
  success: boolean;
  updated: number;
}

// ============================================================
// Internal types (API response shapes, not exported via index)
// ============================================================

export interface SignicAuthState {
  userId: string;
  accessToken: string;
  username: string;
  inboxMailboxId: string;
}

// --- Indexer API types ---

export interface IndexerResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface IndexerSignInMessageData {
  walletAddress: string;
  chainType: string;
  message: string;
  chainId?: number;
}

export interface IndexerWalletAccount {
  walletAddress: string;
  chainType: string;
  names: Array<{ name: string; entitled: boolean }>;
}

export interface IndexerEmailAccountsResult {
  accounts: IndexerWalletAccount[];
}

// --- WildDuck API types ---

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

export interface WildduckMailboxResponse {
  success: boolean;
  results: WildduckMailboxItem[];
  error?: string;
}

export interface WildduckMessageAddress {
  address: string;
  name: string;
}

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

export interface WildduckMessagesResponse {
  success: boolean;
  total: number;
  page: number;
  previousCursor: string | false;
  nextCursor: string | false;
  results: WildduckMessageListItem[];
  error?: string;
}

export interface WildduckUpdateMessageResponse {
  success: boolean;
  updated?: number;
  error?: string;
}
