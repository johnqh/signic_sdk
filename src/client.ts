import { privateKeyToAccount } from 'viem/accounts';
import type { PrivateKeyAccount } from 'viem/accounts';
import { httpGet, httpPost, httpPut } from './network/http.js';
import { SignicError, SignicAuthError } from './errors.js';
import type {
  SignicClientConfig,
  SignicAuthState,
  SignicEmail,
  UnreadEmailsResult,
  MarkAsReadResult,
  IndexerResponse,
  IndexerSignInMessageData,
  IndexerEmailAccountsResult,
  WildduckAuthResponse,
  WildduckMailboxResponse,
  WildduckMessagesResponse,
  WildduckUpdateMessageResponse,
  WildduckMessageListItem,
} from './types.js';

const DEFAULT_EMAIL_DOMAIN = 'signic.email';
const DEFAULT_CHAIN_ID = 1;

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

  /** Returns the wallet address derived from the private key */
  getAddress(): string {
    return this.account.address;
  }

  /** Returns the signic.email address for this wallet */
  getEmailAddress(): string {
    return `${this.account.address}@${this.emailDomain}`;
  }

  /** Returns true if connect() has been called successfully */
  isConnected(): boolean {
    return this.authState !== null;
  }

  /** Authenticate via SIWE signature */
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

    // Step 3: Format signature hex → base64
    const base64Signature = this.formatSignatureToBase64(rawSignature);

    // Step 4: Verify with Indexer (get wallet accounts)
    await this.getWalletAccounts(address, siweMessage, base64Signature);

    // Step 5: Authenticate with WildDuck
    const authResponse = await this.authenticateWithWildduck(
      address,
      base64Signature,
      siweMessage,
    );

    // Step 6: Find INBOX mailbox
    const inboxId = await this.findInboxMailboxId(
      authResponse.id!,
      authResponse.token!,
    );

    this.authState = {
      userId: authResponse.id!,
      accessToken: authResponse.token!,
      username: address,
      inboxMailboxId: inboxId,
    };
  }

  /** Retrieve unread emails from the inbox */
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
      this.wildduckHeaders(),
    );

    if (!response.data.success) {
      throw new SignicError(
        response.data.error ?? 'Failed to get messages',
        'getUnreadEmails',
        response.status,
      );
    }

    return {
      emails: response.data.results.map(this.mapMessageToEmail),
      total: response.data.total,
    };
  }

  /** Mark a message as read */
  async markAsRead(
    messageId: number,
    mailboxId?: string,
  ): Promise<MarkAsReadResult> {
    this.requireAuth();
    const auth = this.authState!;
    const mboxId = mailboxId ?? auth.inboxMailboxId;

    const url = `${this.wildduckUrl}/users/${auth.userId}/mailboxes/${mboxId}/messages/${messageId}`;
    const response = await httpPut<WildduckUpdateMessageResponse>(
      url,
      { seen: true },
      this.wildduckHeaders(),
    );

    if (!response.data.success) {
      throw new SignicError(
        response.data.error ?? 'Failed to mark as read',
        'markAsRead',
        response.status,
      );
    }

    return {
      success: true,
      updated: response.data.updated ?? 1,
    };
  }

  // ============================================================
  // Private helpers
  // ============================================================

  private requireAuth(): void {
    if (!this.authState) {
      throw new SignicAuthError(
        'Not connected. Call connect() first.',
        'requireAuth',
      );
    }
  }

  private async getSiweMessage(
    address: string,
    domain: string,
    url: string,
  ): Promise<string> {
    const params = new URLSearchParams({
      chainId: this.chainId.toString(),
      domain,
      url,
    });
    const endpoint = `${this.indexerUrl}/wallets/${encodeURIComponent(address)}/message?${params}`;

    const response = await httpGet<
      IndexerResponse<IndexerSignInMessageData>
    >(endpoint, {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });

    if (!response.data.success || !response.data.data?.message) {
      throw new SignicError(
        response.data.error ?? 'Failed to get SIWE message',
        'getSiweMessage',
        response.status,
      );
    }

    return response.data.data.message;
  }

  private formatSignatureToBase64(hexSignature: string): string {
    const cleanHex = hexSignature.startsWith('0x')
      ? hexSignature.slice(2)
      : hexSignature;
    return Buffer.from(cleanHex, 'hex')
      .toString('base64')
      .replace(/[\r\n]/g, '');
  }

  private async getWalletAccounts(
    address: string,
    message: string,
    base64Signature: string,
  ): Promise<void> {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-signature': base64Signature.replace(/[\r\n]/g, ''),
      'x-message': encodeURIComponent(message),
      'x-signer': address,
    };
    const endpoint = `${this.indexerUrl}/wallets/${encodeURIComponent(address)}/accounts`;

    const response = await httpGet<
      IndexerResponse<IndexerEmailAccountsResult>
    >(endpoint, headers);

    if (!response.data.success) {
      throw new SignicAuthError(
        response.data.error ?? 'Failed to get wallet accounts',
        'getWalletAccounts',
        response.status,
      );
    }
  }

  private async authenticateWithWildduck(
    address: string,
    base64Signature: string,
    message: string,
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
      { 'Content-Type': 'application/json', Accept: 'application/json' },
    );

    if (
      !response.data.success ||
      !response.data.id ||
      !response.data.token
    ) {
      throw new SignicAuthError(
        response.data.error ?? 'WildDuck authentication failed',
        'authenticateWithWildduck',
        response.status,
      );
    }

    return response.data;
  }

  private async findInboxMailboxId(
    userId: string,
    accessToken: string,
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
        response.status,
      );
    }

    const inbox = response.data.results.find(
      (mb) => mb.specialUse === '\\Inbox' || mb.path === 'INBOX',
    );

    if (!inbox) {
      throw new SignicError('INBOX mailbox not found', 'findInboxMailboxId');
    }

    return inbox.id;
  }

  private wildduckHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${this.authState!.accessToken}`,
    };
  }

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
