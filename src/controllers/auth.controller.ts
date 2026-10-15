import { Request, Response } from 'express';
import { authService } from '@/services/auth.service';
import { sessionService } from '@/services/session.service';
import ResponseUtil from '@/utils/response.util';
import { sessionMeta, uid } from '@/lib/http';

export class AuthController {
  register = async (req: Request, res: Response) => ResponseUtil.created(res, await authService.register(req.body, sessionMeta(req)));
  login = async (req: Request, res: Response) => ResponseUtil.success(res, await authService.login(req.body, sessionMeta(req)));
  refresh = async (req: Request, res: Response) => ResponseUtil.success(res, await authService.refresh(req.body.refreshToken, sessionMeta(req)));

  logout = async (req: Request, res: Response) => {
    await authService.logout(req.user!.sessionId, uid(req));
    return ResponseUtil.success(res, { loggedOut: true });
  };
  logoutAll = async (req: Request, res: Response) => {
    await authService.logoutAll(uid(req));
    return ResponseUtil.success(res, { loggedOut: true });
  };

  me = async (req: Request, res: Response) => ResponseUtil.success(res, await authService.me(uid(req)));

  reauthenticate = async (req: Request, res: Response) =>
    ResponseUtil.success(res, await authService.reauthenticate(uid(req), req.user!.sessionId, req.body.password, req.body.twoFactorCode));

  verifyEmail = async (req: Request, res: Response) => {
    await authService.verifyEmail(req.body.token);
    return ResponseUtil.success(res, { verified: true });
  };
  resendVerification = async (req: Request, res: Response) => {
    await authService.resendVerification(uid(req));
    return ResponseUtil.success(res, { sent: true });
  };
  forgotPassword = async (req: Request, res: Response) => {
    await authService.forgotPassword(req.body.email);
    return ResponseUtil.success(res, { sent: true });
  };
  resetPassword = async (req: Request, res: Response) => {
    await authService.resetPassword(req.body.token, req.body.password);
    return ResponseUtil.success(res, { reset: true });
  };
  changePassword = async (req: Request, res: Response) =>
    ResponseUtil.success(res, { tokens: await authService.changePassword(uid(req), req.user!.sessionId, req.body.currentPassword, req.body.newPassword) });

  sessions = async (req: Request, res: Response) => ResponseUtil.success(res, await sessionService.list(uid(req), req.user!.sessionId));
  revokeSession = async (req: Request, res: Response) => {
    await sessionService.revokeOne(uid(req), req.params.id);
    return ResponseUtil.success(res, { revoked: true });
  };

  twoFactorSetup = async (req: Request, res: Response) => ResponseUtil.success(res, await authService.beginTwoFactorSetup(uid(req)));
  twoFactorEnable = async (req: Request, res: Response) => ResponseUtil.success(res, await authService.enableTwoFactor(uid(req), req.body.code));
  twoFactorDisable = async (req: Request, res: Response) => {
    await authService.disableTwoFactor(uid(req), req.body.password, req.body.code);
    return ResponseUtil.success(res, { disabled: true });
  };
}
export const authController = new AuthController();
