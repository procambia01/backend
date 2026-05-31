import { z } from 'zod';

// ── Register ──────────────────────────────────────────────
// The web client sends: { name, email, password, phone?, referralCode? }
// confirmPassword is stripped client-side before sending, so we make it
// optional here. Password strength is still enforced on the backend.
export const registerValidator = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Password must contain uppercase, lowercase, and a number'
    ),
  // Accept both naming conventions from different clients
  confirmPassword: z.string().optional(),
  passwordConfirm: z.string().optional(),
  referralCode: z.string().optional(),
});

// ── Login ─────────────────────────────────────────────────
export const loginValidator = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional(),
});

// ── Forgot password ───────────────────────────────────────
export const forgotPasswordValidator = z.object({
  email: z.string().email('Invalid email address'),
});

// ── Reset password ────────────────────────────────────────
export const resetPasswordValidator = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Password must contain uppercase, lowercase, and a number'
    ),
  confirmPassword: z.string().optional(),
  passwordConfirm: z.string().optional(),
});

// ── Verify email ──────────────────────────────────────────
export const verifyEmailValidator = z.object({
  token: z.string().min(1, 'Token is required'),
});

// ── Resend verification ───────────────────────────────────
export const resendVerificationValidator = z.object({
  email: z.string().email('Invalid email address'),
});

// ── Change password ───────────────────────────────────────
export const changePasswordValidator = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Password must contain uppercase, lowercase, and a number'
    ),
  confirmPassword: z.string().optional(),
  newPasswordConfirm: z.string().optional(),
});

// ── Two-factor ────────────────────────────────────────────
export const verifyTwoFactorValidator = z.object({
  code: z.string().length(6, 'Code must be 6 digits'),
});
