import { httpGet, httpPost, httpPut } from './network/http.js';
import { SignicError, SignicAuthError } from './errors.js';
import type {
  SignicClientConfig,
  SignMessageResult,
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
 * Authenticates via SIWE (Sign-In with Ethereum) or SIWS (Sign-In with Solana)
 * through a two-service flow:
 * 1. **Indexer API** — generates and verifies the sign-in message
 * 2. **WildDuck API** — issues an access token and serves email data
 *
 * Provide a {@link SignicClientConfig.signMessage} callback that returns both the
 * wallet address and signature. Call {@link connect} with the wallet address to
 * authenticate. Methods that require authentication will throw
 * {@link SignicAuthError} if called before connect.
 *
 * @example
 * ```ts
 * import { SignicClient } from '@sudobility/signic_sdk';
 *
 * const client = new SignicClient({
 *   indexerUrl: 'https://api.signic.email/idx',
 *   wildduckUrl: 'https://api.signic.email/api',
 *   signMessage: async (message) => ({
 *     address: wallet.address,
 *     signature: await wallet.signMessage(message),
 *   }),
 * });
 *
 * await client.connect('0xf39F...');
 *
 * console.log(client.getAddress());      // "0xf39F..."
 * console.log(client.getEmailAddress()); // "0xf39F...@signic.email"
 *
 * // Read emails
 * const { emails, total } = await client.getUnreadEmails(10);
 * const full = await client.getEmail(emails[0].id);
 * await client.markAsRead(emails[0].id);
 * ```
 */
export class SignicClient {
  private readonly indexerUrl: string;
  private readonly wildduckUrl: string;
  private readonly emailDomain: string;
  private readonly chainId: number;
  private readonly signMessageFn: (
    message: string
  ) => Promise<SignMessageResult>;
  private authState: SignicAuthState | null = null;

  constructor(config: SignicClientConfig) {
    this.indexerUrl = config.indexerUrl.replace(/\/+$/, '');
    this.wildduckUrl = config.wildduckUrl.replace(/\/+$/, '');
    this.emailDomain = config.emailDomain ?? DEFAULT_EMAIL_DOMAIN;
    this.chainId = config.chainId ?? DEFAULT_CHAIN_ID;
    this.signMessageFn = config.signMessage;
  }

  /** Returns the wallet address. Requires {@link connect} to have been called. */
  getAddress(): string {
    if (!this.authState) {
      throw new SignicError(
        'No address available. Call connect() first.',
        'getAddress'
      );
    }
    return this.authState.username;
  }

  /** Returns the Signic email address for this wallet (e.g. "0xabc...@signic.email"). Requires {@link connect}. */
  getEmailAddress(): string {
    return `${this.getAddress()}@${this.emailDomain}`;
  }

  /** Returns true if {@link connect} has completed successfully. */
  isConnected(): boolean {
    return this.authState !== null;
  }

  /**
   * Authenticate with the Signic platform.
   *
   * Fetches a sign-in message from the Indexer for the given address, passes it
   * to the {@link SignicClientConfig.signMessage} callback, and uses the returned
   * address + signature pair to complete authentication.
   *
   * @param address - Wallet address to authenticate (EVM hex or Solana base58)
   * @throws {SignicAuthError} If signature verification or WildDuck authentication fails
   * @throws {SignicNetworkError} If any API request fails at the network level
   */
  async connect(address: string): Promise<void> {
    const domain = this.emailDomain;
    const url = `https://${domain}`;

    // Step 1: Fetch the sign-in message from the Indexer
    const siweMessage = await this.fetchSignInMessage(address, domain, url);

    // Step 2: Sign externally via callback — returns { address, signature }
    const result = await this.signMessageFn(siweMessage);
    const base64Signature = this.formatSignatureToBase64(result.signature);

    // Step 3: Verify with Indexer (get wallet accounts)
    await this.getWalletAccounts(result.address, siweMessage, base64Signature);

    // Step 4: Authenticate with WildDuck
    const authResponse = await this.authenticateWithWildduck(
      result.address,
      base64Signature,
      siweMessage
    );

    // Step 5: Find INBOX mailbox
    const inboxId = await this.findInboxMailboxId(
      authResponse.id!,
      authResponse.token!
    );

    this.authState = {
      userId: authResponse.id!,
      accessToken: authResponse.token!,
      username: result.address,
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

    const senderAddress = this.authState!.username.toLowerCase();
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

    const url = `${this.wildduckUrl}/users/name/${encodeURIComponent(senderAddress)}/submit`;

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

  /** Fetch the sign-in message from the Indexer API. */
  private async fetchSignInMessage(
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

  /**
   * Convert a signature to base64 for API headers.
   * Accepts hex (0x-prefixed) or base64. If the input starts with "0x",
   * it is treated as hex and converted; otherwise it is returned as-is.
   */
  private formatSignatureToBase64(signature: string): string {
    if (!signature.startsWith('0x')) {
      return signature.replace(/[\r\n]/g, '');
    }
    const cleanHex = signature.slice(2);
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
   * Creates a random message, signs it via the signMessage callback, and
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

    const result = await this.signMessageFn(message);
    const signature = this.formatSignatureToBase64(result.signature);

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
