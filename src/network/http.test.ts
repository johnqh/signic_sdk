import { describe, it, expect, vi, beforeEach } from 'vitest';
import { httpGet, httpPost, httpPut, handleApiError } from './http.js';
import {
  SignicAuthError,
  SignicNetworkError,
  SignicValidationError,
  SignicError,
} from '../errors.js';

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

describe('httpGet', () => {
  it('returns parsed JSON on success', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: true }));
    const result = await httpGet<{ success: boolean }>(
      'https://api.test/data',
      { Accept: 'application/json' }
    );
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ success: true });
    expect(result.status).toBe(200);
  });

  it('throws SignicNetworkError on fetch failure', async () => {
    mockFetch.mockRejectedValue(new Error('DNS lookup failed'));
    await expect(httpGet('https://api.test/data', {})).rejects.toThrow(
      SignicNetworkError
    );
  });

  it('throws on non-ok status', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'not found' }, 404));
    await expect(httpGet('https://api.test/missing', {})).rejects.toThrow(
      SignicError
    );
  });

  it('throws SignicError on invalid JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    });
    await expect(httpGet('https://api.test/bad-json', {})).rejects.toThrow(
      SignicError
    );
  });
});

describe('httpPost', () => {
  it('sends JSON body and returns parsed response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: '123' }));
    const result = await httpPost<{ id: string }>(
      'https://api.test/create',
      { name: 'test' },
      { 'Content-Type': 'application/json' }
    );
    expect(result.data).toEqual({ id: '123' });
    expect(mockFetch).toHaveBeenCalledWith('https://api.test/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    });
  });
});

describe('httpPut', () => {
  it('sends PUT request with JSON body', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: true, updated: 1 }));
    const result = await httpPut<{ success: boolean; updated: number }>(
      'https://api.test/update/1',
      { seen: true },
      { 'Content-Type': 'application/json' }
    );
    expect(result.data.updated).toBe(1);
    expect(mockFetch).toHaveBeenCalledWith('https://api.test/update/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seen: true }),
    });
  });
});

describe('handleApiError', () => {
  it('returns SignicAuthError for 401', () => {
    const err = handleApiError(401, { error: 'unauthorized' }, 'auth');
    expect(err).toBeInstanceOf(SignicAuthError);
    expect(err.statusCode).toBe(401);
  });

  it('returns SignicAuthError for 403', () => {
    const err = handleApiError(403, { error: 'forbidden' }, 'auth');
    expect(err).toBeInstanceOf(SignicAuthError);
  });

  it('returns SignicValidationError for 400', () => {
    const err = handleApiError(400, { error: 'bad request' }, 'validate');
    expect(err).toBeInstanceOf(SignicValidationError);
    expect(err.statusCode).toBe(400);
  });

  it('returns SignicValidationError for 422', () => {
    const err = handleApiError(422, { error: 'invalid' }, 'validate');
    expect(err).toBeInstanceOf(SignicValidationError);
  });

  it('returns base SignicError for other status codes', () => {
    const err = handleApiError(500, { error: 'server error' }, 'fetch');
    expect(err).toBeInstanceOf(SignicError);
    expect(err).not.toBeInstanceOf(SignicAuthError);
    expect(err).not.toBeInstanceOf(SignicValidationError);
    expect(err.statusCode).toBe(500);
  });

  it('handles null response data', () => {
    const err = handleApiError(500, null, 'fetch');
    expect(err.message).toContain('Unknown error');
  });
});
