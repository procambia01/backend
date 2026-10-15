import { v2 as cloudinary } from 'cloudinary';
import { config } from '@/config/env';
import type { DetectedMime } from '@/lib/file-signature';
import { ServiceUnavailableError } from '@/utils/error.util';
import logger from '@/utils/logger.util';

cloudinary.config({ cloud_name: config.cloudinary.cloudName, api_key: config.cloudinary.apiKey, api_secret: config.cloudinary.apiSecret, secure: true });

const FORMAT: Record<DetectedMime, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/**
 * Private objects (KYC documents, dispute evidence) are stored as Cloudinary
 * `authenticated` assets: there is no public URL. Access is only through a
 * short-lived signed download URL issued after an access-control check + audit.
 * storageKey = `<resourceType>|<format>|<publicId>`.
 */
export class StorageService {
  async putPrivate(buffer: Buffer, mime: DetectedMime, folder: string, name: string): Promise<string> {
    const resourceType = mime === 'application/pdf' ? 'raw' : 'image';
    const publicId = `${config.cloudinary.folder}/${folder}/${name}`;
    try {
      const result = await new Promise<{ public_id: string }>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { public_id: publicId, resource_type: resourceType, type: 'authenticated', overwrite: false, ...(resourceType === 'raw' ? { format: 'pdf' } : { format: FORMAT[mime] }) },
          (err, res) => (err || !res ? reject(err ?? new Error('upload failed')) : resolve(res))
        );
        stream.end(buffer);
      });
      return `${resourceType}|${FORMAT[mime]}|${result.public_id}`;
    } catch (error) {
      logger.error('private upload failed', { message: (error as Error).message });
      throw new ServiceUnavailableError('File storage is temporarily unavailable');
    }
  }

  /** Time-limited download URL (default 2 minutes). */
  signedUrl(storageKey: string, ttlSeconds = config.kyc.signedUrlTtlSeconds): string {
    const [resourceType, format, ...rest] = storageKey.split('|');
    const publicId = rest.join('|');
    return cloudinary.utils.private_download_url(publicId, format, {
      resource_type: resourceType as 'image' | 'raw',
      type: 'authenticated',
      expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
    });
  }

  async deletePrivate(storageKey: string): Promise<void> {
    const [resourceType, , ...rest] = storageKey.split('|');
    try {
      await cloudinary.uploader.destroy(rest.join('|'), { resource_type: resourceType as 'image' | 'raw', type: 'authenticated', invalidate: true });
    } catch (error) {
      logger.error('private delete failed', { message: (error as Error).message });
      throw error;
    }
  }

  /** Public avatar (the only public asset type). */
  async putAvatar(buffer: Buffer, userId: string): Promise<string> {
    const res = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: `${config.cloudinary.folder}/avatars`, public_id: `avatar_${userId}`, overwrite: true, resource_type: 'image', transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto' }] },
        (err, r) => (err || !r ? reject(err ?? new Error('upload failed')) : resolve(r))
      );
      stream.end(buffer);
    });
    return res.secure_url;
  }
}

export const storageService = new StorageService();
