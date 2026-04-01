// src/config/cloudinary.ts
import { v2 as cloudinary } from 'cloudinary';
import { config } from './env';
import logger from '@/utils/logger.util';
import { Readable } from 'stream';

// Configure Cloudinary
cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
  secure: true,
});

export interface CloudinaryUploadOptions {
  folder?: string;
  public_id?: string;
  resource_type?: 'image' | 'video' | 'raw' | 'auto';
  transformation?: any;
  tags?: string[];
}

export interface CloudinaryUploadResult {
  public_id: string;
  version: number;
  signature: string;
  width: number;
  height: number;
  format: string;
  resource_type: string;
  created_at: string;
  tags: string[];
  bytes: number;
  type: string;
  etag: string;
  placeholder: boolean;
  url: string;
  secure_url: string;
  folder?: string;
  original_filename: string;
}

class CloudinaryService {
  /**
   * Convert buffer to stream
   */
  private bufferToStream(buffer: Buffer): Readable {
    const readable = new Readable();
    readable._read = () => {}; // _read is required but you can noop it
    readable.push(buffer);
    readable.push(null);
    return readable;
  }

  /**
   * Upload buffer to Cloudinary
   */
  async uploadBuffer(
    buffer: Buffer,
    options: CloudinaryUploadOptions = {}
  ): Promise<CloudinaryUploadResult> {
    return new Promise((resolve, reject) => {
      const uploadOptions = {
        folder: options.folder || config.cloudinary.folder,
        resource_type: options.resource_type || 'auto',
        public_id: options.public_id,
        transformation: options.transformation,
        tags: options.tags,
      };

      const uploadStream = cloudinary.uploader.upload_stream(
        uploadOptions,
        (error, result) => {
          if (error) {
            logger.error('Cloudinary buffer upload error:', error);
            reject(new Error('Failed to upload buffer to Cloudinary'));
          } else {
            logger.info(`Buffer uploaded to Cloudinary: ${result?.secure_url}`);
            resolve(result as CloudinaryUploadResult);
          }
        }
      );

      this.bufferToStream(buffer).pipe(uploadStream);
    });
  }

  /**
   * Upload file to Cloudinary
   */
  async uploadFile(
    filePath: string,
    options: CloudinaryUploadOptions = {}
  ): Promise<CloudinaryUploadResult> {
    try {
      const uploadOptions = {
        folder: options.folder || config.cloudinary.folder,
        resource_type: options.resource_type || 'auto',
        public_id: options.public_id,
        transformation: options.transformation,
        tags: options.tags,
      };

      const result = await cloudinary.uploader.upload(filePath, uploadOptions);
      
      logger.info(`File uploaded to Cloudinary: ${result.secure_url}`);
      
      return result as CloudinaryUploadResult;
    } catch (error) {
      logger.error('Cloudinary upload error:', error);
      throw new Error('Failed to upload file to Cloudinary');
    }
  }

  /**
   * Upload base64 image to Cloudinary
   */
  async uploadBase64(
    base64String: string,
    options: CloudinaryUploadOptions = {}
  ): Promise<CloudinaryUploadResult> {
    try {
      const uploadOptions = {
        folder: options.folder || config.cloudinary.folder,
        resource_type: options.resource_type || 'image',
        public_id: options.public_id,
        transformation: options.transformation,
        tags: options.tags,
      };

      const result = await cloudinary.uploader.upload(base64String, uploadOptions);
      
      logger.info(`Base64 uploaded to Cloudinary: ${result.secure_url}`);
      
      return result as CloudinaryUploadResult;
    } catch (error) {
      logger.error('Cloudinary base64 upload error:', error);
      throw new Error('Failed to upload base64 to Cloudinary');
    }
  }

  /**
   * Upload multiple files
   */
  async uploadMultiple(
    files: string[],
    options: CloudinaryUploadOptions = {}
  ): Promise<CloudinaryUploadResult[]> {
    try {
      const uploadPromises = files.map(file => this.uploadFile(file, options));
      return await Promise.all(uploadPromises);
    } catch (error) {
      logger.error('Cloudinary multiple upload error:', error);
      throw new Error('Failed to upload multiple files to Cloudinary');
    }
  }

  /**
   * Upload profile image with specific transformations
   */
  async uploadProfileImage(buffer: Buffer, userId: string): Promise<CloudinaryUploadResult> {
    return this.uploadBuffer(buffer, {
      folder: `${config.cloudinary.folder}/profiles`,
      public_id: `profile_${userId}_${Date.now()}`,
      transformation: [
        { width: 500, height: 500, crop: 'fill', gravity: 'face' },
        { quality: 'auto', fetch_format: 'auto' }
      ],
      tags: ['profile', 'user'],
    });
  }

  /**
   * Upload ID document
   */
  async uploadIdDocument(buffer: Buffer, userId: string): Promise<CloudinaryUploadResult> {
    return this.uploadBuffer(buffer, {
      folder: `${config.cloudinary.folder}/id-documents`,
      public_id: `id_${userId}_${Date.now()}`,
      resource_type: 'image',
      transformation: [
        { quality: 'auto', fetch_format: 'auto' }
      ],
      tags: ['id-document', 'verification'],
    });
  }

  /**
   * Upload selfie for verification
   */
  async uploadSelfie(buffer: Buffer, userId: string): Promise<CloudinaryUploadResult> {
    return this.uploadBuffer(buffer, {
      folder: `${config.cloudinary.folder}/selfies`,
      public_id: `selfie_${userId}_${Date.now()}`,
      transformation: [
        { width: 800, height: 800, crop: 'limit' },
        { quality: 'auto', fetch_format: 'auto' }
      ],
      tags: ['selfie', 'verification'],
    });
  }

  /**
   * Upload message attachment
   */
  async uploadMessageAttachment(
    buffer: Buffer,
    swapId: string,
    type: 'image' | 'document' = 'image'
  ): Promise<CloudinaryUploadResult> {
    return this.uploadBuffer(buffer, {
      folder: `${config.cloudinary.folder}/messages/${swapId}`,
      resource_type: type === 'document' ? 'raw' : 'image',
      transformation: type === 'image' ? [
        { width: 1200, height: 1200, crop: 'limit' },
        { quality: 'auto', fetch_format: 'auto' }
      ] : undefined,
      tags: ['message', 'attachment'],
    });
  }

  /**
   * Upload stream to Cloudinary
   */
  uploadStream(
    options: CloudinaryUploadOptions = {},
    callback: (error: any, result?: CloudinaryUploadResult) => void
  ): any {
    const uploadOptions = {
      folder: options.folder || config.cloudinary.folder,
      resource_type: options.resource_type || 'auto',
      public_id: options.public_id,
      transformation: options.transformation,
      tags: options.tags,
    };

    return cloudinary.uploader.upload_stream(uploadOptions, callback);
  }

  /**
   * Delete file from Cloudinary
   */
  async deleteFile(publicId: string, resourceType: 'image' | 'video' | 'raw' = 'image'): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
      logger.info(`File deleted from Cloudinary: ${publicId}`);
    } catch (error) {
      logger.error('Cloudinary delete error:', error);
      throw new Error('Failed to delete file from Cloudinary');
    }
  }

  /**
   * Delete multiple files
   */
  async deleteMultiple(publicIds: string[], resourceType: 'image' | 'video' | 'raw' = 'image'): Promise<void> {
    try {
      await cloudinary.api.delete_resources(publicIds, { resource_type: resourceType });
      logger.info(`Multiple files deleted from Cloudinary: ${publicIds.length} files`);
    } catch (error) {
      logger.error('Cloudinary multiple delete error:', error);
      throw new Error('Failed to delete multiple files from Cloudinary');
    }
  }

  /**
   * Delete folder
   */
  async deleteFolder(folderPath: string): Promise<void> {
    try {
      await cloudinary.api.delete_folder(folderPath);
      logger.info(`Folder deleted from Cloudinary: ${folderPath}`);
    } catch (error) {
      logger.error('Cloudinary folder delete error:', error);
      throw new Error('Failed to delete folder from Cloudinary');
    }
  }

  /**
   * Get file details
   */
  async getFileDetails(publicId: string): Promise<any> {
    try {
      const result = await cloudinary.api.resource(publicId);
      return result;
    } catch (error) {
      logger.error('Cloudinary get file details error:', error);
      throw new Error('Failed to get file details from Cloudinary');
    }
  }

  /**
   * Generate signed URL for private resources
   */
  generateSignedUrl(publicId: string, options: any = {}): string {
    return cloudinary.url(publicId, {
      sign_url: true,
      type: 'authenticated',
      ...options,
    });
  }

  /**
   * Generate transformation URL
   */
  generateTransformationUrl(publicId: string, transformation: any): string {
    return cloudinary.url(publicId, {
      transformation,
      secure: true,
    });
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
    return cloudinary.url(publicId, {
      transformation: [
        { width, height, crop },
        { quality: 'auto', fetch_format: 'auto' }
      ],
      secure: true,
    });
  }

  /**
   * Get thumbnail URL
   */
  getThumbnailUrl(publicId: string, size: number = 150): string {
    return cloudinary.url(publicId, {
      transformation: [
        { width: size, height: size, crop: 'thumb', gravity: 'face' },
        { quality: 'auto', fetch_format: 'auto' }
      ],
      secure: true,
    });
  }

  /**
   * Extract public_id from Cloudinary URL
   */
  extractPublicId(url: string): string | null {
    try {
      const match = url.match(/\/v\d+\/(.+)\.\w+$/);
      return match ? match[1] : null;
    } catch (error) {
      logger.error('Error extracting public_id from URL:', error);
      return null;
    }
  }
}

// Create singleton instance
const cloudinaryService = new CloudinaryService();

export { cloudinary, cloudinaryService };
export default cloudinaryService;