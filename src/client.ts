import { privateKeyToAccount } from 'viem/accounts';
import type { PrivateKeyAccount } from 'viem/accounts';
import { httpGet, httpPost, httpPut } from './network/http.js';
import { SignicError, SignicAuthError } from './errors.js';
import type {
  SignicClientConfig,
  SignicAuthState,
  SignicEmail,
  SignicEmailDetail,
  SendEmailParams,
  SendEmailResult,
  UnreadEmailsResult,
  MarkAsReadResult,
  IndexerResponse,
  IndexerSignInMessageData,
  IndexerEmailAccountsResult,
  WildduckAuthResponse,
  WildduckMailboxResponse,
  WildduckMessagesResponse,
  WildduckMessageDetailResponse,
  WildduckUpdateMessageResponse,
  WildduckMessageListItem,
  WildduckSubmitResponse,
} from './types.js';

const DEFAULT_EMAIL_DOMAIN = 'signic.email';
const DEFAULT_CHAIN_ID = 1;

/**
 * Main client for the Signic decentralized email platform.
 *
 * Authenticates via SIWE (Sign-In with Ethereum) through a two-service flow:
 * 1. **Indexer API** — generates and verifies the SIWE message
 * 2. **WildDuck API** — issues an access token and serves email data
 *
 * Call {@link connect} before using any email methods. Methods that require
 * authentication will throw {@link SignicAuthError} if called before connect.
 *
 * @example
 * ```ts
 * import { SignicClient } from '@sudobility/signic_sdk';
 *
 * const client = new SignicClient({
 *   privateKey: '0xac09...',
 *   indexerUrl: 'https://api.signic.email/idx',
 *   wildduckUrl: 'https://api.signic.email/api',
 * });
 *
 * // Derive addresses (no auth needed)
 * console.log(client.getAddress());      // "0xf39F..."
 * console.log(client.getEmailAddress()); // "0xf39F...@signic.email"
 *
 * // Authenticate
 * await client.connect();
 *
 * // Read emails
 * const { emails, total } = await client.getUnreadEmails(10);
 * const full = await client.getEmail(emails[0].id);
 * await client.markAsRead(emails[0].id);
 * ```
 */
export class SignicClient {
  private readonly account: PrivateKeyAccount;
  private readonly indexerUrl: string;
  private readonly wildduckUrl: string;
  private readonly emailDomain: string;
  private readonly chainId: number;
  private authState: SignicAuthState | null = null;

  constructor(config: SignicClientConfig) {
    this.account = privateKeyToAccount(config.privateKey);
    this.indexerUrl = config.indexerUrl.replace(/\/+$/, '');
    this.wildduckUrl = config.wildduckUrl.replace(/\/+$/, '');
    this.emailDomain = config.emailDomain ?? DEFAULT_EMAIL_DOMAIN;
    this.chainId = config.chainId ?? DEFAULT_CHAIN_ID;
  }

  /** Returns the EVM wallet address derived from the private key. Does not require auth. */
  getAddress(): string {
    return this.account.address;
  }

  /** Returns the Signic email address for this wallet (e.g. "0xabc...@signic.email"). Does not require auth. */
  getEmailAddress(): string {
    return `${this.account.address}@${this.emailDomain}`;
  }

  /** Returns true if {@link connect} has completed successfully. */
  isConnected(): boolean {
    return this.authState !== null;
  }

  /**
   * Authenticate with the Signic platform via SIWE.
   *
   * Performs a 6-step flow:
   * 1. Fetch a SIWE message from the Indexer
   * 2. Sign the message with the wallet's private key (via viem)
   * 3. Convert the signature from hex to base64
   * 4. Verify the signature with the Indexer (also fetches wallet accounts)
   * 5. Authenticate with WildDuck using the verified signature
   * 6. Locate the INBOX mailbox ID for subsequent email operations
   *
   * @throws {SignicAuthError} If signature verification or WildDuck authentication fails
   * @throws {SignicNetworkError} If any API request fails at the network level
   */
  async connect(): Promise<void> {
    const address = this.account.address;
    const domain = this.emailDomain;
    const url = `https://${domain}`;

    // Step 1: Get SIWE message from Indexer
    const siweMessage = await this.getSiweMessage(address, domain, url);

    // Step 2: Sign the message with viem
    const rawSignature = await this.account.signMessage({
      message: siweMessage,
    });

    // Step 3: Format signature hex -> base64
    const base64Signature = this.formatSignatureToBase64(rawSignature);

    // Step 4: Verify with Indexer (get wallet accounts)
    await this.getWalletAccounts(address, siweMessage, base64Signature);

    // Step 5: Authenticate with WildDuck
    const authResponse = await this.authenticateWithWildduck(
      address,
      base64Signature,
      siweMessage
    );

    // Step 6: Find INBOX mailbox
    const inboxId = await this.findInboxMailboxId(
      authResponse.id!,
      authResponse.token!
    );

    this.authState = {
      userId: authResponse.id!,
      accessToken: authResponse.token!,
      username: address,
      inboxMailboxId: inboxId,
    };
  }

  /**
   * Fetch unread emails from the inbox.
   * Returns summary objects — use {@link getEmail} for the full message body.
   *
   * @param limit - Maximum number of emails to return (default: 50)
   * @throws {SignicAuthError} If not connected
   */
  async getUnreadEmails(limit: number = 50): Promise<UnreadEmailsResult> {
    this.requireAuth();
    const auth = this.authState!;

    const params = new URLSearchParams({
      unseen: 'true',
      limit: limit.toString(),
    });
    const url = `${this.wildduckUrl}/users/${auth.userId}/mailboxes/${auth.inboxMailboxId}/messages?${params}`;

    const response = await httpGet<WildduckMessagesResponse>(
      url,
      this.wildduckHeaders()
    );

    if (!response.data.success) {
      throw new SignicError(
        response.data.error ?? 'Failed to get messages',
        'getUnreadEmails',
        response.status
      );
    }

    return {
      emails: response.data.results.map(this.mapMessageToEmail),
      total: response.data.total,
    };
  }

  /**
   * Fetch the complete email by its ID, including HTML/text body, all recipients,
   * attachments, flags, and verification results.
   *
   * @param emailId - WildDuck message UID (from {@link SignicEmail.id})
   * @param mailboxId - Mailbox to fetch from (defaults to INBOX)
   * @throws {SignicAuthError} If not connected
   */
  async getEmail(
    emailId: number,
    mailboxId?: string
  ): Promise<SignicEmailDetail> {
    this.requireAuth();
    const auth = this.authState!;
    const mboxId = mailboxId ?? auth.inboxMailboxId;

    const url = `${this.wildduckUrl}/users/${auth.userId}/mailboxes/${mboxId}/messages/${emailId}`;
    const response = await httpGet<WildduckMessageDetailResponse>(
      url,
      this.wildduckHeaders()
    );

    if (!response.data.success) {
      throw new SignicError(
        response.data.error ?? 'Failed to get message',
        'getEmail',
        response.status
      );
    }

    const msg = response.data;
    return {
      id: msg.id,
      mailboxId: msg.mailbox,
      thread: msg.thread,
      from: msg.from ?? { address: '', name: '' },
      replyTo: msg.replyTo,
      to: msg.to,
      cc: msg.cc ?? [],
      bcc: msg.bcc ?? [],
      subject: msg.subject,
      messageId: msg.messageId,
      date: msg.date,
      idate: msg.idate,
      size: msg.size,
      seen: msg.seen,
      flagged: msg.flagged,
      deleted: msg.deleted,
      draft: msg.draft,
      answered: msg.answered,
      forwarded: msg.forwarded,
      html: msg.html ?? [],
      text: msg.text ?? '',
      attachments: msg.attachments ?? [],
      verificationResults: msg.verificationResults,
    };
  }

  /**
   * Mark a message as read (sets the \\Seen flag).
   *
   * @param messageId - WildDuck message UID
   * @param mailboxId - Mailbox containing the message (defaults to INBOX)
   * @throws {SignicAuthError} If not connected
   */
  async markAsRead(
    messageId: number,
    mailboxId?: string
  ): Promise<MarkAsReadResult> {
    this.requireAuth();
    const auth = this.authState!;
    const mboxId = mailboxId ?? auth.inboxMailboxId;

    const url = `${this.wildduckUrl}/users/${auth.userId}/mailboxes/${mboxId}/messages/${messageId}`;
    const response = await httpPut<WildduckUpdateMessageResponse>(
      url,
      { seen: true },
      this.wildduckHeaders()
    );

    if (!response.data.success) {
      throw new SignicError(
        response.data.error ?? 'Failed to mark as read',
        'markAsRead',
        response.status
      );
    }

    return {
      success: true,
      updated: response.data.updated ?? 1,
    };
  }

  /**
   * Send an email via WildDuck.
   *
   * Uses indexer-style authentication: signs a random message with the
   * wallet's private key and includes it in the request payload.
   *
   * @param params - Email parameters (to, subject, html, optional text)
   * @throws {SignicAuthError} If not connected
   * @throws {SignicError} If WildDuck rejects the submission
   */
  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    this.requireAuth();

    const senderAddress = this.account.address.toLowerCase();
    const senderEmail = `${senderAddress}@${this.emailDomain}`;
    const recipients = Array.isArray(params.to) ? params.to : [params.to];

    const indexerAuth = await this.generateIndexerAuth();

    const body: Record<string, unknown> = {
      from: { address: senderEmail },
      to: recipients.map((addr) => ({ address: addr })),
      subject: params.subject,
      html: params.html,
      indexer: indexerAuth,
    };
    if (params.text) {
      body.text = params.text;
    }

    const username = senderAddress;
    const url = `${this.wildduckUrl}/users/name/${encodeURIComponent(username)}/submit`;

    const response = await httpPost<WildduckSubmitResponse>(url, body, {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });

    if (!response.data.success) {
      throw new SignicError(
        response.data.error ?? 'Failed to send email',
        'sendEmail',
        response.status
      );
    }

    return {
      messageId: String(response.data.message?.id ?? ''),
      queueId: response.data.queueId ?? '',
    };
  }

  // ============================================================
  // Private helpers
  // ============================================================

  /** Guard that throws SignicAuthError if connect() hasn't been called. */
  private requireAuth(): void {
    if (!this.authState) {
      throw new SignicAuthError(
        'Not connected. Call connect() first.',
        'requireAuth'
      );
    }
  }

  /** Fetch the SIWE message to sign from the Indexer API. */
  private async getSiweMessage(
    address: string,
    domain: string,
    url: string
  ): Promise<string> {
    const params = new URLSearchParams({
      chainId: this.chainId.toString(),
      domain,
      url,
    });
    const endpoint = `${this.indexerUrl}/wallets/${encodeURIComponent(address)}/message?${params}`;

    const response = await httpGet<IndexerResponse<IndexerSignInMessageData>>(
      endpoint,
      {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }
    );

    if (!response.data.success || !response.data.data?.message) {
      throw new SignicError(
        response.data.error ?? 'Failed to get SIWE message',
        'getSiweMessage',
        response.status
      );
    }

    return response.data.data.message;
  }

  /** Convert a hex-encoded signature (0x...) to a base64 string for API headers. */
  private formatSignatureToBase64(hexSignature: string): string {
    const cleanHex = hexSignature.startsWith('0x')
      ? hexSignature.slice(2)
      : hexSignature;
    const binaryString = cleanHex
      .match(/.{2}/g)!
      .map((byte) => String.fromCharCode(parseInt(byte, 16)))
      .join('');
    return btoa(binaryString).replace(/[\r\n]/g, '');
  }

  /**
   * Verify the SIWE signature with the Indexer and retrieve wallet accounts.
   * Sends the signature + message in custom headers (x-signature, x-message, x-signer).
   */
  private async getWalletAccounts(
    address: string,
    message: string,
    base64Signature: string
  ): Promise<void> {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-signature': base64Signature.replace(/[\r\n]/g, ''),
      'x-message': encodeURIComponent(message),
      'x-signer': address,
    };
    const endpoint = `${this.indexerUrl}/wallets/${encodeURIComponent(address)}/accounts`;

    const response = await httpGet<IndexerResponse<IndexerEmailAccountsResult>>(
      endpoint,
      headers
    );

    if (!response.data.success) {
      throw new SignicAuthError(
        response.data.error ?? 'Failed to get wallet accounts',
        'getWalletAccounts',
        response.status
      );
    }
  }

  /**
   * Exchange the verified SIWE signature for a WildDuck access token.
   * The token is a Bearer token used for all subsequent WildDuck API calls.
   */
  private async authenticateWithWildduck(
    address: string,
    base64Signature: string,
    message: string
  ): Promise<WildduckAuthResponse> {
    const body = {
      username: address,
      signature: base64Signature,
      message,
      signer: address,
      scope: 'master',
      token: true,
      protocol: 'API',
    };

    const response = await httpPost<WildduckAuthResponse>(
      `${this.wildduckUrl}/authenticate`,
      body,
      { 'Content-Type': 'application/json', Accept: 'application/json' }
    );

    if (!response.data.success || !response.data.id || !response.data.token) {
      throw new SignicAuthError(
        response.data.error ?? 'WildDuck authentication failed',
        'authenticateWithWildduck',
        response.status
      );
    }

    return response.data;
  }

  /** Find the INBOX mailbox ID by querying the user's mailbox list. */
  private async findInboxMailboxId(
    userId: string,
    accessToken: string
  ): Promise<string> {
    const url = `${this.wildduckUrl}/users/${userId}/mailboxes?counters=true`;

    const response = await httpGet<WildduckMailboxResponse>(url, {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    });

    if (!response.data.success) {
      throw new SignicError(
        response.data.error ?? 'Failed to get mailboxes',
        'findInboxMailboxId',
        response.status
      );
    }

    const inbox = response.data.results.find(
      (mb) => mb.specialUse === '\\Inbox' || mb.path === 'INBOX'
    );

    if (!inbox) {
      throw new SignicError('INBOX mailbox not found', 'findInboxMailboxId');
    }

    return inbox.id;
  }

  /** Build the standard Authorization + JSON headers for WildDuck API calls. */
  private wildduckHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${this.authState!.accessToken}`,
    };
  }

  /**
   * Generate indexer-style authentication for the WildDuck submit endpoint.
   * Creates a random message, signs it with the wallet's private key, and
   * returns the message + base64-encoded signature.
   */
  private async generateIndexerAuth(): Promise<{
    message: string;
    signature: string;
  }> {
    const randomBytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(randomBytes);
    const randomHex = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const timestamp = Date.now();
    const message = `Indexer authentication message: ${randomHex} at ${timestamp}`;

    const rawSignature = await this.account.signMessage({ message });
    const signature = this.formatSignatureToBase64(rawSignature);

    return { message, signature };
  }

  /** Map a WildDuck message list item to the public SignicEmail shape. */
  private mapMessageToEmail(msg: WildduckMessageListItem): SignicEmail {
    return {
      id: msg.id,
      mailboxId: msg.mailbox,
      from: msg.from ?? { address: '', name: '' },
      to: msg.to,
      subject: msg.subject,
      date: msg.date,
      intro: msg.intro,
      seen: msg.seen,
      hasAttachments: msg.attachments,
    };
  }
}
