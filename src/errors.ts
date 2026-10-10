import type { CourierName } from './types.js';

/** Raised when a courier rejects a request or answers with something unexpected. */
export class CourierError extends Error {
  readonly courier: CourierName;
  /** HTTP status when the failure came from the transport layer. */
  readonly httpStatus: number | undefined;
  /** The courier's response body, when there was one. */
  readonly raw: unknown;

  constructor(courier: CourierName, message: string, options: { httpStatus?: number; raw?: unknown; cause?: unknown } = {}) {
    super(`[${courier}] ${message}`, { cause: options.cause });
    this.name = 'CourierError';
    this.courier = courier;
    this.httpStatus = options.httpStatus;
    this.raw = options.raw;
  }
}

/** Raised before any network call when the input cannot be sent as is. */
export class ValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = 'ValidationError';
    this.field = field;
  }
}
