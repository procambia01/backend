import { Request, Response } from 'express';
import ResponseUtil from '@/utils/response.util';
import { LocationService } from '@/services/location.service';

export class LocationController {
  private locationService: LocationService;

  constructor() {
    this.locationService = new LocationService();
  }

  getSavedLocations = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const locations = await this.locationService.getSavedLocations(userId);
    return ResponseUtil.success(res, locations);
  };

  saveLocation = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const locationData = req.body;
    const location = await this.locationService.saveLocation(userId, locationData);
    return ResponseUtil.created(res, location, 'Location saved');
  };

  updateLocation = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const updateData = req.body;
    const location = await this.locationService.updateLocation(id, userId, updateData);
    return ResponseUtil.success(res, location, 'Location updated');
  };

  deleteLocation = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    await this.locationService.deleteLocation(id, userId);
    return ResponseUtil.success(res, null, 'Location deleted');
  };

  setPrimaryLocation = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    await this.locationService.setPrimaryLocation(id, userId);
    return ResponseUtil.success(res, null, 'Primary location set');
  };
}

