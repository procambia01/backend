import { Request, Response } from 'express';
import { AuthService } from '@/services/auth.service';
import ResponseUtil from '@/utils/response.util';
// import { AuthMiddleware } from '@/middleware/auth.middleware';

export class AuthController {
  private authService: AuthService;

  constructor() {
    this.authService = new AuthService();
  }

  /**
   * Register a new user
   */
  register = async (req: Request, res: Response): Promise<Response> => {
    const userData = req.body;
    const result = await this.authService.register(userData);
    return ResponseUtil.created(res, result, 'Registration successful');
  };

  /**
   * Login user
   */
  login = async (req: Request, res: Response): Promise<Response> => {
    const { email, password, rememberMe } = req.body;
    const result = await this.authService.login(email, password, rememberMe);
    return ResponseUtil.success(res, result, 'Login successful');
  };

  /**
   * Logout user
   */
  logout = async (req: Request, res: Response): Promise<Response> => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      await this.authService.logout(token);
    }
    return ResponseUtil.success(res, null, 'Logout successful');
  };

  /**
   * Forgot password
   */
  forgotPassword = async (req: Request, res: Response): Promise<Response> => {
    const { email } = req.body;
    await this.authService.forgotPassword(email);
    return ResponseUtil.success(res, null, 'Password reset email sent');
  };

  /**
   * Reset password
   */
  resetPassword = async (req: Request, res: Response): Promise<Response> => {
    const { token, password } = req.body;
    await this.authService.resetPassword(token, password);
    return ResponseUtil.success(res, null, 'Password reset successful');
  };

  /**
   * Verify email
   */
  verifyEmail = async (req: Request, res: Response): Promise<Response> => {
    const { token } = req.body;
    await this.authService.verifyEmail(token);
    return ResponseUtil.success(res, null, 'Email verified successfully');
  };

  /**
   * Resend verification email
   */
  resendVerification = async (req: Request, res: Response): Promise<Response> => {
    const { email } = req.body;
    await this.authService.resendVerificationEmail(email);
    return ResponseUtil.success(res, null, 'Verification email sent');
  };

  /**
   * Get current user
   */
  getCurrentUser = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const user = await this.authService.getCurrentUser(userId);
    return ResponseUtil.success(res, user);
  };

  /**
   * Change password
   */
  changePassword = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const { currentPassword, newPassword } = req.body;
    await this.authService.changePassword(userId, currentPassword, newPassword);
    return ResponseUtil.success(res, null, 'Password changed successfully');
  };

  /**
   * Enable two-factor authentication
   */
  enableTwoFactor = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const result = await this.authService.enableTwoFactor(userId);
    return ResponseUtil.success(res, result, 'Two-factor authentication enabled');
  };

  /**
   * Disable two-factor authentication
   */
  disableTwoFactor = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    await this.authService.disableTwoFactor(userId);
    return ResponseUtil.success(res, null, 'Two-factor authentication disabled');
  };

  /**
   * Verify two-factor code
   */
  verifyTwoFactor = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const { code } = req.body;
    await this.authService.verifyTwoFactor(userId, code);
    return ResponseUtil.success(res, null, 'Two-factor code verified');
  };

  /**
   * Get all active sessions
   */
  getSessions = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const sessions = await this.authService.getSessions(userId);
    return ResponseUtil.success(res, sessions);
  };

  /**
   * Revoke a session
   */
  revokeSession = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const { sessionId } = req.params;
    await this.authService.revokeSession(userId, sessionId);
    return ResponseUtil.success(res, null, 'Session revoked');
  };

  /**
   * Revoke all sessions except current
   */
  revokeAllSessions = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const currentToken = req.headers.authorization?.split(' ')[1];
    await this.authService.revokeAllSessions(userId, currentToken);
    return ResponseUtil.success(res, null, 'All sessions revoked');
  };
}