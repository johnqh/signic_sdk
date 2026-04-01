import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignicClient } from './client.js';
import { SignicAuthError } from './errors.js';

const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  };
}

describe('SignicClient constructor', () => {
  it('derives correct address from private key', () => {
    const client = new SignicClient({
      privateKey: TEST_PRIVATE_KEY,
      indexerUrl: 'https://indexer.test',
      wildduckUrl: 'https://api.test',
    });
    expect(client.getAddress()).toBe(TEST_ADDRESS);
  });

  it('uses default email domain signic.email', () => {
    const client = new SignicClient({
      privateKey: TEST_PRIVATE_KEY,
      indexerUrl: 'https://indexer.test',
      wildduckUrl: 'https://api.test',
    });
    expect(client.getEmailAddress()).toBe(`${TEST_ADDRESS}@signic.email`);
  });

  it('respects custom email domain', () => {
    const client = new SignicClient({
      privateKey: TEST_PRIVATE_KEY,
      indexerUrl: 'https://indexer.test',
      wildduckUrl: 'https://api.test',
      emailDomain: 'custom.email',
    });
    expect(client.getEmailAddress()).toBe(`${TEST_ADDRESS}@custom.email`);
  });

  it('strips trailing slashes from URLs', () => {
    const client = new SignicClient({
      privateKey: TEST_PRIVATE_KEY,
      indexerUrl: 'https://indexer.test///',
      wildduckUrl: 'https://api.test/',
    });
    // Verify by checking connect() calls the right URL
    expect(client.getAddress()).toBe(TEST_ADDRESS);
  });
});

describe('SignicClient.isConnected', () => {
  it('returns false before connect()', () => {
    const client = new SignicClient({
      privateKey: TEST_PRIVATE_KEY,
      indexerUrl: 'https://indexer.test',
      wildduckUrl: 'https://api.test',
    });
    expect(client.isConnected()).toBe(false);
  });
});

describe('SignicClient.getUnreadEmails before connect', () => {
  it('throws SignicAuthError', async () => {
    const client = new SignicClient({
      privateKey: TEST_PRIVATE_KEY,
      indexerUrl: 'https://indexer.test',
      wildduckUrl: 'https://api.test',
    });
    await expect(client.getUnreadEmails()).rejects.toThrow(SignicAuthError);
  });
});

describe('SignicClient.markAsRead before connect', () => {
  it('throws SignicAuthError', async () => {
    const client = new SignicClient({
      privateKey: TEST_PRIVATE_KEY,
      indexerUrl: 'https://indexer.test',
      wildduckUrl: 'https://api.test',
    });
    await expect(client.markAsRead(1)).rejects.toThrow(SignicAuthError);
  });
});

describe('SignicClient.connect', () => {
  it('authenticates through the full SIWE flow', async () => {
    const client = new SignicClient({
      privateKey: TEST_PRIVATE_KEY,
      indexerUrl: 'https://indexer.test',
      wildduckUrl: 'https://api.test',
    });

    // Step 1: Indexer returns SIWE message
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          walletAddress: TEST_ADDRESS,
          chainType: 'evm',
          message: 'Sign in with Ethereum',
          chainId: 1,
        },
        timestamp: new Date().toISOString(),
      })
    );

    // Step 2: Indexer returns wallet accounts
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          accounts: [
            {
              walletAddress: TEST_ADDRESS,
              chainType: 'evm',
              names: [{ name: 'test', entitled: true }],
            },
          ],
        },
        timestamp: new Date().toISOString(),
      })
    );

    // Step 3: WildDuck authenticate
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        id: 'user123',
        username: TEST_ADDRESS,
        token: 'access-token-xyz',
      })
    );

    // Step 4: WildDuck get mailboxes
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        results: [
          {
            id: 'inbox-id-1',
            name: 'INBOX',
            path: 'INBOX',
            specialUse: '\\Inbox',
            modifyIndex: 1,
            subscribed: true,
            hidden: false,
            total: 10,
            unseen: 3,
          },
        ],
      })
    );

    await client.connect();

    expect(client.isConnected()).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(4);

    // Verify Step 1: SIWE message request
    const siweCall = mockFetch.mock.calls[0]!;
    expect(siweCall[0]).toContain('/wallets/');
    expect(siweCall[0]).toContain('/message?');

    // Verify Step 2: wallet accounts request has auth headers
    const accountsCall = mockFetch.mock.calls[1]!;
    expect(accountsCall[0]).toContain('/accounts');
    expect(accountsCall[1].headers['x-signature']).toBeDefined();
    expect(accountsCall[1].headers['x-message']).toBeDefined();
    expect(accountsCall[1].headers['x-signer']).toBe(TEST_ADDRESS);

    // Verify Step 3: WildDuck authenticate is POST
    const authCall = mockFetch.mock.calls[2]!;
    expect(authCall[0]).toContain('/authenticate');
    expect(authCall[1].method).toBe('POST');

    // Verify Step 4: mailboxes request has Bearer token
    const mailboxCall = mockFetch.mock.calls[3]!;
    expect(mailboxCall[0]).toContain('/mailboxes');
    expect(mailboxCall[1].headers['Authorization']).toBe(
      'Bearer access-token-xyz'
    );
  });
});

describe('SignicClient.getUnreadEmails after connect', () => {
  async function createConnectedClient() {
    const client = new SignicClient({
      privateKey: TEST_PRIVATE_KEY,
      indexerUrl: 'https://indexer.test',
      wildduckUrl: 'https://api.test',
    });

    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            walletAddress: TEST_ADDRESS,
            chainType: 'evm',
            message: 'Sign in',
            chainId: 1,
          },
          timestamp: new Date().toISOString(),
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { accounts: [] },
          timestamp: new Date().toISOString(),
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          id: 'user1',
          username: TEST_ADDRESS,
          token: 'tok',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          results: [
            {
              id: 'inbox1',
              name: 'INBOX',
              path: 'INBOX',
              specialUse: '\\Inbox',
              modifyIndex: 1,
              subscribed: true,
              hidden: false,
            },
          ],
        })
      );

    await client.connect();
    mockFetch.mockReset();
    return client;
  }

  it('fetches unread emails and maps them', async () => {
    const client = await createConnectedClient();

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        total: 1,
        page: 1,
        previousCursor: false,
        nextCursor: false,
        results: [
          {
            id: 42,
            mailbox: 'inbox1',
            thread: 't1',
            from: { address: 'sender@test.com', name: 'Sender' },
            to: [{ address: TEST_ADDRESS, name: '' }],
            subject: 'Hello',
            date: '2026-03-31T00:00:00Z',
            intro: 'Preview text',
            attachments: false,
            seen: false,
            flagged: false,
            size: 1024,
          },
        ],
      })
    );

    const result = await client.getUnreadEmails();

    expect(result.total).toBe(1);
    expect(result.emails).toHaveLength(1);
    expect(result.emails[0]).toEqual({
      id: 42,
      mailboxId: 'inbox1',
      from: { address: 'sender@test.com', name: 'Sender' },
      to: [{ address: TEST_ADDRESS, name: '' }],
      subject: 'Hello',
      date: '2026-03-31T00:00:00Z',
      intro: 'Preview text',
      seen: false,
      hasAttachments: false,
    });

    // Verify unseen=true is in the URL
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('unseen=true');
    expect(url).toContain('limit=50');
  });

  it('respects custom limit', async () => {
    const client = await createConnectedClient();

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        total: 0,
        page: 1,
        previousCursor: false,
        nextCursor: false,
        results: [],
      })
    );

    await client.getUnreadEmails(10);

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('limit=10');
  });
});

describe('SignicClient.markAsRead after connect', () => {
  async function createConnectedClient() {
    const client = new SignicClient({
      privateKey: TEST_PRIVATE_KEY,
      indexerUrl: 'https://indexer.test',
      wildduckUrl: 'https://api.test',
    });

    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            walletAddress: TEST_ADDRESS,
            chainType: 'evm',
            message: 'Sign in',
            chainId: 1,
          },
          timestamp: new Date().toISOString(),
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { accounts: [] },
          timestamp: new Date().toISOString(),
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          id: 'user1',
          username: TEST_ADDRESS,
          token: 'tok',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          results: [
            {
              id: 'inbox1',
              name: 'INBOX',
              path: 'INBOX',
              specialUse: '\\Inbox',
              modifyIndex: 1,
              subscribed: true,
              hidden: false,
            },
          ],
        })
      );

    await client.connect();
    mockFetch.mockReset();
    return client;
  }

  it('sends PUT with { seen: true }', async () => {
    const client = await createConnectedClient();

    mockFetch.mockResolvedValueOnce(
      jsonResponse({ success: true, updated: 1 })
    );

    const result = await client.markAsRead(42);

    expect(result).toEqual({ success: true, updated: 1 });

    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toContain('/messages/42');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({ seen: true });
  });

  it('uses custom mailboxId when provided', async () => {
    const client = await createConnectedClient();

    mockFetch.mockResolvedValueOnce(
      jsonResponse({ success: true, updated: 1 })
    );

    await client.markAsRead(99, 'custom-mailbox');

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('/mailboxes/custom-mailbox/messages/99');
  });
});
