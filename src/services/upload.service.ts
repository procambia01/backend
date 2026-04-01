// src/services/upload.service.ts
import { Readable } from 'stream';
import cloudinaryService, { CloudinaryUploadResult } from '@/config/cloudinary';
import { BadRequestError } from '@/utils/error.util';
import logger from '@/utils/logger.util';
import { config } from '@/config/env';

export class UploadService {
  /**
   * Upload file buffer to Cloudinary
   */
  async uploadBuffer(
    buffer: Buffer,
    folder: string,
    filename?: string
  ): Promise<CloudinaryUploadResult> {
    try {
      return new Promise((resolve, reject) => {
        const stream = cloudinaryService.uploadStream(
          {
            folder: `${config.cloudinary.folder}/${folder}`,
            public_id: filename,
            resource_type: 'auto',
          },
          (error: any, result?: CloudinaryUploadResult) => {
            if (error) {
              logger.error('Cloudinary upload error:', error);
              reject(new Error('Failed to upload file'));
            } else if (result) {
              resolve(result);
            } else {
              reject(new Error('Upload failed - no result returned'));
            }
          }
        );

        const readable = Readable.from(buffer);
        readable.pipe(stream);
      });
    } catch (error) {
      logger.error('Upload buffer error:', error);
      throw new Error('Failed to upload file');
    }
  }

  /**
   * Upload file from Express Multer
   */
  async uploadFile(
    file: Express.Multer.File,
    folder: string
  ): Promise<CloudinaryUploadResult> {
    if (!file || !file.buffer) {
      throw new BadRequestError('No file provided');
    }

    const filename = `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;
    return this.uploadBuffer(file.buffer, folder, filename);
  }

  /**
   * Upload multiple files
   */
  async uploadMultiple(
    files: Express.Multer.File[],
    folder: string
  ): Promise<CloudinaryUploadResult[]> {
    if (!files || files.length === 0) {
      throw new BadRequestError('No files provided');
    }

    const uploadPromises = files.map(file => this.uploadFile(file, folder));
    return Promise.all(uploadPromises);
  }

  /**
   * Upload profile image
   */
  async uploadProfileImage(
    file: Express.Multer.File,
    userId: string
  ): Promise<CloudinaryUploadResult> {
    if (!file || !file.buffer) {
      throw new BadRequestError('No file provided');
    }

    return cloudinaryService.uploadProfileImage(file.buffer, userId);
  }

  /**
   * Upload ID document
   */
  async uploadIdDocument(
    file: Express.Multer.File,
    userId: string
  ): Promise<CloudinaryUploadResult> {
    if (!file || !file.buffer) {
      throw new BadRequestError('No file provided');
    }

    return cloudinaryService.uploadIdDocument(file.buffer, userId);
  }

  /**
   * Upload selfie
   */
  async uploadSelfie(
    file: Express.Multer.File,
    userId: string
  ): Promise<CloudinaryUploadResult> {
    if (!file || !file.buffer) {
      throw new BadRequestError('No file provided');
    }

    return cloudinaryService.uploadSelfie(file.buffer, userId);
  }

  /**
   * Upload message attachment
   */
  async uploadMessageAttachment(
    file: Express.Multer.File,
    swapId: string
  ): Promise<CloudinaryUploadResult> {
    if (!file || !file.buffer) {
      throw new BadRequestError('No file provided');
    }

    const type = file.mimetype.startsWith('image/') ? 'image' : 'document';
    return cloudinaryService.uploadMessageAttachment(file.buffer, swapId, type);
  }

  /**
   * Delete file from Cloudinary
   */
  async deleteFile(publicId: string, resourceType: 'image' | 'video' | 'raw' = 'image'): Promise<void> {
    return cloudinaryService.deleteFile(publicId, resourceType);
  }

  /**
   * Delete multiple files
   */
  async deleteMultiple(
    publicIds: string[],
    resourceType: 'image' | 'video' | 'raw' = 'image'
  ): Promise<void> {
    return cloudinaryService.deleteMultiple(publicIds, resourceType);
  }

  /**
   * Get optimized image URL
   */
  getOptimizedImageUrl(
    publicId: string,
    width?: number,
    height?: number,
    crop: string = 'fill'
  ): string {
    return cloudinaryService.getOptimizedImageUrl(publicId, width, height, crop);
  }

  /**
   * Get thumbnail URL
   */
  getThumbnailUrl(publicId: string, size: number = 150): string {
    return cloudinaryService.getThumbnailUrl(publicId, size);
  }

  /**
   * Extract public ID from URL
   */
  extractPublicId(url: string): string | null {
    return cloudinaryService.extractPublicId(url);
  }
}