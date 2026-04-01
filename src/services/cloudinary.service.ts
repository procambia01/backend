// src/services/cloudinary.service.ts
import { v2 as cloudinary } from 'cloudinary';
import { config } from '@/config/env';
import logger from '@/utils/logger.util';

cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key:    config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
});

export class CloudinaryService {
  async uploadImage(
    fileBuffer: Buffer,
    options: { folder: string; publicId?: string; transformation?: object },
  ): Promise<{ url: string; publicId: string }> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: options.folder,
          public_id: options.publicId,
          resource_type: 'image',
          transformation: options.transformation ?? [
            { width: 800, height: 800, crop: 'limit', quality: 'auto' },
          ],
        },
        (err, result) => {
          if (err || !result) return reject(err ?? new Error('Upload failed'));
          resolve({ url: result.secure_url, publicId: result.public_id });
        },
      );
      stream.end(fileBuffer);
    });
  }

  async uploadAvatar(buffer: Buffer, userId: string) {
    return this.uploadImage(buffer, {
      folder: 'swapfx/avatars',
      publicId: `avatar_${userId}`,
      transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto' }],
    });
  }

  async uploadDocument(buffer: Buffer, userId: string, docType: string) {
    return this.uploadImage(buffer, {
      folder: 'swapfx/documents',
      publicId: `doc_${userId}_${docType}_${Date.now()}`,
      transformation: [{ width: 1200, quality: 'auto' }],
    });
  }

  async deleteImage(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (err) {
      logger.error('Cloudinary delete error:', err);
    }
  }
}
