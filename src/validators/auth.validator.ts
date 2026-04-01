import { z } from 'zod';

export const registerValidator = z.object({
  body: z.object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(100),
    email: z.string().email('Invalid email address'),
    phone: z.string().optional(),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one uppercase letter, one lowercase letter, and one number'),
    passwordConfirm: z.string(),
    referralCode: z.string().optional(),
  }).refine((data) => data.password === data.passwordConfirm, {
    message: "Passwords don't match",
    path: ['passwordConfirm'],
  }),
});

export const loginValidator = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
    rememberMe: z.boolean().optional(),
  }),
});

export const forgotPasswordValidator = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
  }),
});

export const resetPasswordValidator = z.object({
  body: z.object({
    token: z.string().min(1, 'Token is required'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one uppercase letter, one lowercase letter, and one number'),
    passwordConfirm: z.string(),
  }).refine((data) => data.password === data.passwordConfirm, {
    message: "Passwords don't match",
    path: ['passwordConfirm'],
  }),
});

export const verifyEmailValidator = z.object({
  body: z.object({
    token: z.string().min(1, 'Token is required'),
  }),
});

export const resendVerificationValidator = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
  }),
});

export const changePasswordValidator = z.object({
  body: z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one uppercase letter, one lowercase letter, and one number'),
    newPasswordConfirm: z.string(),
  }).refine((data) => data.newPassword === data.newPasswordConfirm, {
    message: "Passwords don't match",
    path: ['newPasswordConfirm'],
  }),
});

export const verifyTwoFactorValidator = z.object({
  body: z.object({
    code: z.string().length(6, 'Code must be 6 digits'),
  }),
});