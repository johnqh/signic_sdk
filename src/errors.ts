/**
 * Base error class for all Signic SDK errors.
 * Carries the operation name and optional HTTP status code for diagnostics.
 *
 * @example
 * ```ts
 * try {
 *   await client.getUnreadEmails();
 * } catch (err) {
 *   if (err instanceof SignicError) {
 *     console.error(err.operation, err.statusCode, err.message);
 *   }
 * }
 * ```
 */
export class SignicError extends Error {
  /** The SDK operation that failed (e.g. "getUnreadEmails", "connect") */
  public readonly operation: string;
  /** HTTP status code from the API response, if applicable */
  public readonly statusCode: number | undefined;

  constructor(message: string, operation: string, statusCode?: number) {
    super(message);
    this.name = 'SignicError';
    this.operation = operation;
    this.statusCode = statusCode;
  }
}

/**
 * Thrown on authentication or authorization failures (HTTP 401/403).
 * Also thrown when calling methods that require {@link SignicClient.connect} before use.
 */
export class SignicAuthError extends SignicError {
  constructor(message: string, operation: string, statusCode?: number) {
    super(message, operation, statusCode);
    this.name = 'SignicAuthError';
  }
}

/**
 * Thrown when a network request fails entirely (DNS failure, timeout, no response).
 * Has no statusCode since no HTTP response was received.
 */
export class SignicNetworkError extends SignicError {
  constructor(message: string, operation: string) {
    super(message, operation);
    this.name = 'SignicNetworkError';
  }
}

/**
 * Thrown on input validation failures (HTTP 400/422).
 * Typically indicates malformed request parameters.
 */
export class SignicValidationError extends SignicError {
  constructor(message: string, operation: string, statusCode?: number) {
    super(message, operation, statusCode);
    this.name = 'SignicValidationError';
  }
}
