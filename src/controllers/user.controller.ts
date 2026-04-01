import { Request, Response } from 'express';
import { UserService } from '@/services/user.service';
import ResponseUtil from '@/utils/response.util';
import PaginationUtil from '@/utils/pagination.util';   

export class UserController {
  private userService: UserService;

  constructor() {
    this.userService = new UserService();
  }

  /**
   * Get all users
   */
  getAllUsers = async (req: Request, res: Response): Promise<Response> => {
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.userService.getAllUsers(pagination);
    return ResponseUtil.paginated(
      res,
      result.data,
      result.meta.page,
      result.meta.perPage,
      result.meta.total
    );
  };

  /**
   * Search users
   */
  searchUsers = async (req: Request, res: Response): Promise<Response> => {
    const { q, country, city, verified, minRating } = req.query;
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.userService.searchUsers(
      { q: q as string, country: country as string, city: city as string, verified: verified === 'true', minRating: minRating ? Number(minRating) : undefined },
      pagination
    );
    return ResponseUtil.paginated(
      res,
      result.data,
      result.meta.page,
      result.meta.perPage,
      result.meta.total
    );
  };

  /**
   * Get nearby users
   */
  getNearbyUsers = async (req: Request, res: Response): Promise<Response> => {
    const { latitude, longitude, radius } = req.query;
    const users = await this.userService.getNearbyUsers(
      Number(latitude),
      Number(longitude),
      Number(radius) || 10
    );
    return ResponseUtil.success(res, users);
  };

  /**
   * Get user by ID
   */
  getUserById = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const user = await this.userService.getUserById(id);
    return ResponseUtil.success(res, user);
  };

  /**
   * Update profile
   */
  updateProfile = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const updateData = req.body;
    const user = await this.userService.updateProfile(id, updateData);
    return ResponseUtil.success(res, user, 'Profile updated successfully');
  };

  /**
   * Delete account
   */
  deleteAccount = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    await this.userService.deleteAccount(id);
    return ResponseUtil.success(res, null, 'Account deleted successfully');
  };

  /**
   * Upload profile image
   */
  uploadProfileImage = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const file = req.file;
    if (!file) {
      return ResponseUtil.badRequest(res, 'No file uploaded');
    }
    const result = await this.userService.uploadProfileImage(id, file);
    return ResponseUtil.success(res, result, 'Profile image uploaded successfully');
  };

  /**
   * Delete profile image
   */
  deleteProfileImage = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    await this.userService.deleteProfileImage(id);
    return ResponseUtil.success(res, null, 'Profile image deleted successfully');
  };

  /**
   * Get user statistics
   */
  getUserStats = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const stats = await this.userService.getUserStats(id);
    return ResponseUtil.success(res, stats);
  };

  /**
   * Get user ratings
   */
  getUserRatings = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.userService.getUserRatings(id, pagination);
    return ResponseUtil.paginated(
      res,
      result.data,
      result.meta.page,
      result.meta.perPage,
      result.meta.total
    );
  };

  /**
   * Get user swaps
   */
  getUserSwaps = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.userService.getUserSwaps(id, pagination);
    return ResponseUtil.paginated(
      res,
      result.data,
      result.meta.page,
      result.meta.perPage,
      result.meta.total
    );
  };

  /**
   * Get user offers
   */
  getUserOffers = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.userService.getUserOffers(id, pagination);
    return ResponseUtil.paginated(
      res,
      result.data,
      result.meta.page,
      result.meta.perPage,
      result.meta.total
    );
  };

  /**
   * Update preferences
   */
  updatePreferences = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const preferences = req.body;
    const user = await this.userService.updatePreferences(id, preferences);
    return ResponseUtil.success(res, user, 'Preferences updated successfully');
  };

  /**
   * Update location
   */
  updateLocation = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const { latitude, longitude, city, state, country } = req.body;
    const user = await this.userService.updateLocation(id, {
      latitude,
      longitude,
      city,
      state,
      country,
    });
    return ResponseUtil.success(res, user, 'Location updated successfully');
  };

  /**
   * Verify phone
   */
  verifyPhone = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const { phone, code } = req.body;
    await this.userService.verifyPhone(id, phone, code);
    return ResponseUtil.success(res, null, 'Phone verified successfully');
  };

  /**
   * Submit verification
   */
  submitVerification = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const file = req.file;
    const { documentType, documentNumber, country } = req.body;
    if (!file) {
      return ResponseUtil.badRequest(res, 'No document uploaded');
    }
    await this.userService.submitVerification(id, file, {
      documentType,
      documentNumber,
      country,
    });
    return ResponseUtil.success(res, null, 'Verification submitted successfully');
  };

  /**
   * Upload verification selfie
   */
  uploadVerificationSelfie = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const file = req.file;
    if (!file) {
      return ResponseUtil.badRequest(res, 'No selfie uploaded');
    }
    await this.userService.uploadVerificationSelfie(id, file);
    return ResponseUtil.success(res, null, 'Selfie uploaded successfully');
  };

  /**
   * Get verification status
   */
  getVerificationStatus = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const status = await this.userService.getVerificationStatus(id);
    return ResponseUtil.success(res, status);
  };

  /**
   * Block user
   */
  blockUser = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const { blockedId, reason } = req.body;
    await this.userService.blockUser(userId, blockedId, reason);
    return ResponseUtil.success(res, null, 'User blocked successfully');
  };

  /**
   * Unblock user
   */
  unblockUser = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const { id } = req.params;
    await this.userService.unblockUser(userId, id);
    return ResponseUtil.success(res, null, 'User unblocked successfully');
  };

  /**
   * Get blocked users
   */
  getBlockedUsers = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const blockedUsers = await this.userService.getBlockedUsers(id);
    return ResponseUtil.success(res, blockedUsers);
  };

  /**
   * Add favorite
   */
  addFavorite = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const { favoriteId, notes } = req.body;
    await this.userService.addFavorite(userId, favoriteId, notes);
    return ResponseUtil.success(res, null, 'User added to favorites');
  };

  /**
   * Remove favorite
   */
  removeFavorite = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const { favoriteId } = req.params;
    await this.userService.removeFavorite(userId, favoriteId);
    return ResponseUtil.success(res, null, 'User removed from favorites');
  };

  /**
   * Get favorites
   */
  getFavorites = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const favorites = await this.userService.getFavorites(id);
    return ResponseUtil.success(res, favorites);
  };

  /**
   * Subscribe to premium
   */
  subscribePremium = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const { tier, duration } = req.body;
    const result = await this.userService.subscribePremium(id, tier, duration);
    return ResponseUtil.success(res, result, 'Premium subscription successful');
  };

  /**
   * Cancel premium
   */
  cancelPremium = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    await this.userService.cancelPremium(id);
    return ResponseUtil.success(res, null, 'Premium subscription cancelled');
  };

  /**
   * Get premium status
   */
  getPremiumStatus = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const status = await this.userService.getPremiumStatus(id);
    return ResponseUtil.success(res, status);
  };

  /**
   * Get activity log
   */
  getActivityLog = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.userService.getActivityLog(id, pagination);
    return ResponseUtil.paginated(
      res,
      result.data,
      result.meta.page,
      result.meta.perPage,
      result.meta.total
    );
  };
}