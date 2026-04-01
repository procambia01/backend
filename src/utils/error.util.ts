export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly errors?: any[];

  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    errors?: any[]
  ) {
    super(message);
    
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.errors = errors;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = 'Bad Request', errors?: any[]) {
    super(message, 400, true, errors);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, true);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, true);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(message, 404, true);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Conflict') {
    super(message, 409, true);
  }
}

export class ValidationError extends AppError {
  constructor(message: string = 'Validation failed', errors?: any[]) {
    super(message, 422, true, errors);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message: string = 'Too many requests') {
    super(message, 429, true);
  }
}

export class InternalServerError extends AppError {
  constructor(message: string = 'Internal server error') {
    super(message, 500, true);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service unavailable') {
    super(message, 503, true);
  }
}

// Custom business logic errors
export class EmailAlreadyExistsError extends ConflictError {
  constructor() {
    super('Email already exists');
  }
}

export class PhoneAlreadyExistsError extends ConflictError {
  constructor() {
    super('Phone number already exists');
  }
}

export class InvalidCredentialsError extends UnauthorizedError {
  constructor() {
    super('Invalid email or password');
  }
}

export class AccountNotVerifiedError extends ForbiddenError {
  constructor() {
    super('Please verify your email address');
  }
}

export class AccountBannedError extends ForbiddenError {
  constructor(reason?: string) {
    super(reason || 'Your account has been banned');
  }
}

export class AccountSuspendedError extends ForbiddenError {
  constructor() {
    super('Your account has been suspended');
  }
}

export class InvalidTokenError extends UnauthorizedError {
  constructor() {
    super('Invalid or expired token');
  }
}

export class TokenExpiredError extends UnauthorizedError {
  constructor() {
    super('Token has expired');
  }
}

export class InsufficientPermissionsError extends ForbiddenError {
  constructor() {
    super('Insufficient permissions');
  }
}

export class UserNotFoundError extends NotFoundError {
  constructor() {
    super('User not found');
  }
}

export class OfferNotFoundError extends NotFoundError {
  constructor() {
    super('Offer not found');
  }
}

export class SwapNotFoundError extends NotFoundError {
  constructor() {
    super('Swap not found');
  }
}

export class InvalidSwapStatusError extends BadRequestError {
  constructor(message: string = 'Invalid swap status for this operation') {
    super(message);
  }
}

export class MaxSwapAmountExceededError extends BadRequestError {
  constructor(maxAmount: number) {
    super(`Maximum swap amount is ${maxAmount}`);
  }
}

export class InsufficientFundsError extends BadRequestError {
  constructor() {
    super('Insufficient funds');
  }
}

export class PaymentFailedError extends BadRequestError {
  constructor(message: string = 'Payment failed') {
    super(message);
  }
}

export class FileUploadError extends BadRequestError {
  constructor(message: string = 'File upload failed') {
    super(message);
  }
}

export class InvalidFileTypeError extends BadRequestError {
  constructor(allowedTypes: string[]) {
    super(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`);
  }
}

export class FileSizeTooLargeError extends BadRequestError {
  constructor(maxSize: number) {
    super(`File size too large. Maximum size: ${maxSize} bytes`);
  }
}

export class LocationNotFoundError extends BadRequestError {
  constructor() {
    super('Location not found');
  }
}

export class RateLimitExceededError extends TooManyRequestsError {
  constructor() {
    super('Rate limit exceeded. Please try again later');
  }
}

export class DatabaseError extends InternalServerError {
  constructor(message: string = 'Database operation failed') {
    super(message);
  }
}

export class ExternalServiceError extends ServiceUnavailableError {
  constructor(service: string) {
    super(`${service} is currently unavailable`);
  }
}