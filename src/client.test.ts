import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignicClient } from './client.js';
import { SignicAuthError, SignicError } from './errors.js';

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TEST_SIGNATURE =
  '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab1c';
const TEST_SIGN_MESSAGE = vi.fn().mockResolvedValue({
  address: TEST_ADDRESS,
  signature: TEST_SIGNATURE,
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  TEST_SIGN_MESSAGE.mockClear();
});

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  };
}

function makeClient(signMessage = TEST_SIGN_MESSAGE) {
  return new SignicClient({
    indexerUrl: 'https://indexer.test',
    wildduckUrl: 'https://api.test',
    signMessage,
  });
}

describe('SignicClient constructor', () => {
  it('strips trailing slashes from URLs', () => {
    const client = new SignicClient({
      indexerUrl: 'https://indexer.test///',
      wildduckUrl: 'https://api.test/',
      signMessage: TEST_SIGN_MESSAGE,
    });
    expect(client.isConnected()).toBe(false);
  });
});

describe('SignicClient.getAddress before connect', () => {
  it('throws SignicError', () => {
    const client = makeClient();
    expect(() => client.getAddress()).toThrow(SignicError);
  });
});

describe('SignicClient.isConnected', () => {
  it('returns false before connect()', () => {
    const client = makeClient();
    expect(client.isConnected()).toBe(false);
  });
});

describe('SignicClient.connect', () => {
  it('authenticates by calling signMessage callback', async () => {
    const client = makeClient();

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

    await client.connect(TEST_ADDRESS);

    expect(client.isConnected()).toBe(true);
    expect(client.getAddress()).toBe(TEST_ADDRESS);
    expect(client.getEmailAddress()).toBe(`${TEST_ADDRESS}@signic.email`);
    expect(TEST_SIGN_MESSAGE).toHaveBeenCalledWith('Sign in with Ethereum');
    expect(mockFetch).toHaveBeenCalledTimes(4);

    // Verify SIWE message request
    const siweCall = mockFetch.mock.calls[0]!;
    expect(siweCall[0]).toContain('/wallets/');
    expect(siweCall[0]).toContain('/message?');

    // Verify wallet accounts request has auth headers
    const accountsCall = mockFetch.mock.calls[1]!;
    expect(accountsCall[0]).toContain('/accounts');
    expect(accountsCall[1].headers['x-signature']).toBeDefined();
    expect(accountsCall[1].headers['x-message']).toBeDefined();
    expect(accountsCall[1].headers['x-signer']).toBe(TEST_ADDRESS);

    // Verify WildDuck authenticate is POST
    const authCall = mockFetch.mock.calls[2]!;
    expect(authCall[0]).toContain('/authenticate');
    expect(authCall[1].method).toBe('POST');

    // Verify mailboxes request has Bearer token
    const mailboxCall = mockFetch.mock.calls[3]!;
    expect(mailboxCall[0]).toContain('/mailboxes');
    expect(mailboxCall[1].headers['Authorization']).toBe(
      'Bearer access-token-xyz'
    );
  });

  it('uses the address from signMessage result for auth', async () => {
    // signMessage returns a DIFFERENT address than the one passed to connect
    const differentAddress = '0x1234567890abcdef1234567890abcdef12345678';
    const signFn = vi.fn().mockResolvedValue({
      address: differentAddress,
      signature: TEST_SIGNATURE,
    });
    const client = makeClient(signFn);

    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            walletAddress: TEST_ADDRESS,
            chainType: 'evm',
            message: 'msg',
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
          id: 'u1',
          username: differentAddress,
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

    await client.connect(TEST_ADDRESS);

    // Auth should use the address returned by signMessage
    expect(client.getAddress()).toBe(differentAddress);
    const accountsCall = mockFetch.mock.calls[1]!;
    expect(accountsCall[1].headers['x-signer']).toBe(differentAddress);
  });

  it('accepts base64 signature from callback', async () => {
    const base64Sig = 'SGVsbG8gV29ybGQ=';
    const signFn = vi.fn().mockResolvedValue({
      address: TEST_ADDRESS,
      signature: base64Sig,
    });
    const client = makeClient(signFn);

    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            walletAddress: TEST_ADDRESS,
            chainType: 'evm',
            message: 'msg',
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
          id: 'u1',
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

    await client.connect(TEST_ADDRESS);

    expect(client.isConnected()).toBe(true);
    // base64 signature should be passed through as-is
    const accountsCall = mockFetch.mock.calls[1]!;
    expect(accountsCall[1].headers['x-signature']).toBe(base64Sig);
  });

  it('respects custom email domain', async () => {
    const client = new SignicClient({
      indexerUrl: 'https://indexer.test',
      wildduckUrl: 'https://api.test',
      emailDomain: 'custom.email',
      signMessage: TEST_SIGN_MESSAGE,
    });

    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            walletAddress: TEST_ADDRESS,
            chainType: 'evm',
            message: 'msg',
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
          id: 'u1',
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

    await client.connect(TEST_ADDRESS);
    expect(client.getEmailAddress()).toBe(`${TEST_ADDRESS}@custom.email`);
  });
});

describe('SignicClient.getUnreadEmails before connect', () => {
  it('throws SignicAuthError', async () => {
    const client = makeClient();
    await expect(client.getUnreadEmails()).rejects.toThrow(SignicAuthError);
  });
});

describe('SignicClient.markAsRead before connect', () => {
  it('throws SignicAuthError', async () => {
    const client = makeClient();
    await expect(client.markAsRead(1)).rejects.toThrow(SignicAuthError);
  });
});

// Helper to create a connected client for email operation tests
async function createConnectedClient() {
  const client = makeClient();

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

  await client.connect(TEST_ADDRESS);
  mockFetch.mockReset();
  TEST_SIGN_MESSAGE.mockClear();
  return client;
}

describe('SignicClient.getUnreadEmails after connect', () => {
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

describe('SignicClient.sendEmail before connect', () => {
  it('throws SignicAuthError', async () => {
    const client = makeClient();
    await expect(
      client.sendEmail({
        to: 'test@signic.email',
        subject: 'Hi',
        html: '<p>Hi</p>',
      })
    ).rejects.toThrow(SignicAuthError);
  });
});

describe('SignicClient.sendEmail after connect', () => {
  it('sends email via WildDuck submit endpoint', async () => {
    const client = await createConnectedClient();

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        message: { id: 'msg-123' },
        queueId: 'queue-456',
      })
    );

    const result = await client.sendEmail({
      to: 'recipient@signic.email',
      subject: 'Test Subject',
      html: '<p>Hello</p>',
      text: 'Hello',
    });

    expect(result).toEqual({
      messageId: 'msg-123',
      queueId: 'queue-456',
    });

    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toContain('/users/name/');
    expect(url).toContain('/submit');
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body);
    expect(body.from.address).toContain(TEST_ADDRESS.toLowerCase());
    expect(body.to).toEqual([{ address: 'recipient@signic.email' }]);
    expect(body.subject).toBe('Test Subject');
    expect(body.html).toBe('<p>Hello</p>');
    expect(body.text).toBe('Hello');
    expect(body.indexer).toBeDefined();
    expect(body.indexer.message).toContain('Indexer authentication message:');
    expect(body.indexer.signature).toBeTruthy();
    expect(TEST_SIGN_MESSAGE).toHaveBeenCalled();
  });

  it('handles string array for to field', async () => {
    const client = await createConnectedClient();

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        message: { id: 'msg-789' },
        queueId: 'queue-012',
      })
    );

    await client.sendEmail({
      to: ['a@signic.email', 'b@signic.email'],
      subject: 'Multi',
      html: '<p>Hi all</p>',
    });

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.to).toEqual([
      { address: 'a@signic.email' },
      { address: 'b@signic.email' },
    ]);
  });
});
