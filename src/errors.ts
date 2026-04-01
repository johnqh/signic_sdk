export class SignicError extends Error {
  public readonly operation: string;
  public readonly statusCode: number | undefined;

  constructor(message: string, operation: string, statusCode?: number) {
    super(message);
    this.name = 'SignicError';
    this.operation = operation;
    this.statusCode = statusCode;
  }
}

export class SignicAuthError extends SignicError {
  constructor(message: string, operation: string, statusCode?: number) {
    super(message, operation, statusCode);
    this.name = 'SignicAuthError';
  }
}

export class SignicNetworkError extends SignicError {
  constructor(message: string, operation: string) {
    super(message, operation);
    this.name = 'SignicNetworkError';
  }
}

export class SignicValidationError extends SignicError {
  constructor(message: string, operation: string, statusCode?: number) {
    super(message, operation, statusCode);
    this.name = 'SignicValidationError';
  }
}
