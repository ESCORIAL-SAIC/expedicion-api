export class BusinessError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'BusinessError';
    this.statusCode = statusCode;
    this.code = code;
  }

  toResponseBody() {
    return { error: { code: this.code, message: this.message } };
  }
}

export class DbUnavailableError extends BusinessError {
  constructor(message: string) {
    super(503, 'DB_UNAVAILABLE', message);
    this.name = 'DbUnavailableError';
  }
}
