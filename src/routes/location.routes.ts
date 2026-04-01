import { Router as LocationRouter } from 'express';
import { LocationController } from '@/controllers/location.controller';
import { authenticate } from '@/middleware/auth.middleware';
import { validateBody } from '@/middleware/validate.middleware';
import { saveLocationValidator } from '@/validators/location.validator';
import { asyncHandler } from '@/middleware/error.middleware';

const locationRouter = LocationRouter();
const locationController = new LocationController();

locationRouter.get('/saved', authenticate, asyncHandler(locationController.getSavedLocations));
locationRouter.post('/save', authenticate, validateBody(saveLocationValidator), asyncHandler(locationController.saveLocation));
locationRouter.put('/:id', authenticate, validateBody(saveLocationValidator), asyncHandler(locationController.updateLocation));
locationRouter.delete('/:id', authenticate, asyncHandler(locationController.deleteLocation));
locationRouter.post('/:id/set-primary', authenticate, asyncHandler(locationController.setPrimaryLocation));

export { locationRouter as default };
