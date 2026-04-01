import { describe, it, expect } from 'vitest';
import {
  SignicError,
  SignicAuthError,
  SignicNetworkError,
  SignicValidationError,
} from './errors.js';

describe('SignicError', () => {
  it('stores message, operation, and statusCode', () => {
    const err = new SignicError('something failed', 'testOp', 500);
    expect(err.message).toBe('something failed');
    expect(err.operation).toBe('testOp');
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe('SignicError');
  });

  it('statusCode is undefined when not provided', () => {
    const err = new SignicError('fail', 'op');
    expect(err.statusCode).toBeUndefined();
  });

  it('is an instance of Error', () => {
    const err = new SignicError('fail', 'op');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('SignicAuthError', () => {
  it('extends SignicError', () => {
    const err = new SignicAuthError('unauthorized', 'auth', 401);
    expect(err).toBeInstanceOf(SignicError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SignicAuthError');
    expect(err.statusCode).toBe(401);
  });
});

describe('SignicNetworkError', () => {
  it('extends SignicError with no statusCode', () => {
    const err = new SignicNetworkError('timeout', 'fetch');
    expect(err).toBeInstanceOf(SignicError);
    expect(err.name).toBe('SignicNetworkError');
    expect(err.statusCode).toBeUndefined();
  });
});

describe('SignicValidationError', () => {
  it('extends SignicError', () => {
    const err = new SignicValidationError('bad input', 'validate', 400);
    expect(err).toBeInstanceOf(SignicError);
    expect(err.name).toBe('SignicValidationError');
    expect(err.statusCode).toBe(400);
  });
});
