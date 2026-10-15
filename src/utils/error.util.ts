import type { ErrorCode } from '@/contracts';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode = 500,
    code: ErrorCode = 'INTERNAL_ERROR',
    details?: unknown,
    isOperational = true
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: unknown, code: ErrorCode = 'BAD_REQUEST') {
    super(message, 400, code, details);
  }
}
export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, 422, 'VALIDATION_ERROR', details);
  }
}
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', code: ErrorCode = 'UNAUTHORIZED') {
    super(message, 401, code);
  }
}
export class ReauthRequiredError extends UnauthorizedError {
  constructor() {
    super('Please confirm your password to continue', 'REAUTH_REQUIRED');
  }
}
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code: ErrorCode = 'FORBIDDEN', details?: unknown) {
    super(message, 403, code, details);
  }
}
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}
export class ConflictError extends AppError {
  constructor(message = 'Conflict', code: ErrorCode = 'CONFLICT', details?: unknown) {
    super(message, 409, code, details);
  }
}
export class InvalidStateError extends ConflictError {
  constructor(message = 'This action is not allowed in the current state', details?: unknown) {
    super(message, 'INVALID_STATE', details);
  }
}
export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests', details?: unknown) {
    super(message, 429, 'RATE_LIMITED', details);
  }
}
export class LimitExceededError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 403, 'LIMIT_EXCEEDED', details);
  }
}
export class PlanRequiredError extends AppError {
  constructor(message = 'This feature requires a paid plan', details?: unknown) {
    super(message, 403, 'PLAN_REQUIRED', details);
  }
}
export class VerificationRequiredError extends AppError {
  constructor(message = 'Identity verification is required for this action') {
    super(message, 403, 'VERIFICATION_REQUIRED');
  }
}
export class UploadInvalidError extends AppError {
  constructor(message = 'Invalid upload') {
    super(message, 400, 'UPLOAD_INVALID');
  }
}
export class PaymentMismatchError extends AppError {
  constructor(message = 'Payment does not match the expected amount') {
    super(message, 409, 'PAYMENT_MISMATCH');
  }
}
export class RiskBlockedError extends AppError {
  constructor(message = 'This action is temporarily unavailable on your account') {
    super(message, 403, 'RISK_BLOCKED');
  }
}
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}
export class InternalServerError extends AppError {
  constructor(message = 'Internal server error') {
    super(message, 500, 'INTERNAL_ERROR');
  }
}

// Named business errors
export class EmailAlreadyExistsError extends ConflictError {
  constructor() {
    super('An account with this email already exists');
  }
}
export class InvalidCredentialsError extends UnauthorizedError {
  constructor(message = 'Invalid email or password') {
    super(message);
  }
}
export class InvalidTokenError extends UnauthorizedError {
  constructor() {
    super('Invalid or expired token');
  }
}
export class TokenExpiredError extends UnauthorizedError {
  constructor() {
    super('Token has expired', 'TOKEN_EXPIRED');
  }
}
export class AccountBannedError extends ForbiddenError {
  constructor(reason?: string) {
    super(reason ? `Your account has been banned: ${reason}` : 'Your account has been banned');
  }
}
export class AccountSuspendedError extends ForbiddenError {
  constructor(reason?: string) {
    super(reason ? `Your account has been suspended: ${reason}` : 'Your account has been suspended');
  }
}
export class UserNotFoundError extends NotFoundError {
  constructor() {
    super('User not found');
  }
}
export class OfferUnavailableError extends AppError {
  constructor(message = 'This offer is no longer available') {
    super(message, 409, 'OFFER_UNAVAILABLE');
  }
}
export class InsufficientAvailabilityError extends AppError {
  constructor(message = 'The requested amount is no longer available on this offer', details?: unknown) {
    super(message, 409, 'INSUFFICIENT_AVAILABILITY', details);
  }
}
export class RateMismatchError extends AppError {
  constructor(message = 'The amounts do not match the exchange rate') {
    super(message, 422, 'RATE_MISMATCH');
  }
}
