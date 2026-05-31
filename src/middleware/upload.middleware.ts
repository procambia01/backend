// backend/src/middleware/upload.middleware.ts
import multer, { FileFilterCallback } from 'multer';
import { Request } from 'express';
import path from 'path';
import { config } from '@/config/env';
import { BadRequestError, FileSizeTooLargeError, InvalidFileTypeError } from '@/utils/error.util';
import { nanoid } from 'nanoid';

// File type validators
const imageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const documentTypes = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const videoTypes = ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm'];

export class UploadMiddleware {
  /**
   * Configure multer storage
   */
  private static storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, path.join(process.cwd(), 'uploads'));
    },
    filename: (req, file, cb) => {
      const uniqueId = nanoid(16);
      const ext = path.extname(file.originalname);
      const filename = `${uniqueId}${ext}`;
      cb(null, filename);
    },
  });

  /**
   * Memory storage (for direct upload to Cloudinary)
   */
  private static memoryStorage = multer.memoryStorage();

  /**
   * File filter for images only
   */
  private static imageFilter = (
    req: Request,
    file: Express.Multer.File,
    cb: FileFilterCallback
  ): void => {
    if (imageTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new InvalidFileTypeError(imageTypes));
    }
  };

  /**
   * File filter for documents only
   */
  private static documentFilter = (
    req: Request,
    file: Express.Multer.File,
    cb: FileFilterCallback
  ): void => {
    if (documentTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new InvalidFileTypeError(documentTypes));
    }
  };

  /**
   * File filter for videos only
   */
  private static videoFilter = (
    req: Request,
    file: Express.Multer.File,
    cb: FileFilterCallback
  ): void => {
    if (videoTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new InvalidFileTypeError(videoTypes));
    }
  };

  /**
   * File filter for allowed types from config
   */
  private static allowedTypesFilter = (
    req: Request,
    file: Express.Multer.File,
    cb: FileFilterCallback
  ): void => {
    if (config.upload.allowedFileTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new InvalidFileTypeError(config.upload.allowedFileTypes));
    }
  };

  /**
   * Upload single image
   */
  static uploadImage(fieldName: string = 'image') {
    return multer({
      storage: this.memoryStorage,
      limits: {
        fileSize: config.upload.maxFileSize,
      },
      fileFilter: this.imageFilter,
    }).single(fieldName);
  }

  /**
   * Upload multiple images
   */
  static uploadImages(fieldName: string = 'images', maxCount: number = 10) {
    return multer({
      storage: this.memoryStorage,
      limits: {
        fileSize: config.upload.maxFileSize,
      },
      fileFilter: this.imageFilter,
    }).array(fieldName, maxCount);
  }

  /**
   * Upload single document
   */
  static uploadDocument(fieldName: string = 'document') {
    return multer({
      storage: this.memoryStorage,
      limits: {
        fileSize: config.upload.maxFileSize,
      },
      fileFilter: this.documentFilter,
    }).single(fieldName);
  }

  /**
   * Upload multiple documents
   */
  static uploadDocuments(fieldName: string = 'documents', maxCount: number = 5) {
    return multer({
      storage: this.memoryStorage,
      limits: {
        fileSize: config.upload.maxFileSize,
      },
      fileFilter: this.documentFilter,
    }).array(fieldName, maxCount);
  }

  /**
   * Upload single video
   */
  static uploadVideo(fieldName: string = 'video') {
    return multer({
      storage: this.memoryStorage,
      limits: {
        fileSize: config.upload.maxFileSize * 5, // 5x larger for videos
      },
      fileFilter: this.videoFilter,
    }).single(fieldName);
  }

  /**
   * Upload any file type (from allowed types in config)
   */
  static uploadFile(fieldName: string = 'file') {
    return multer({
      storage: this.memoryStorage,
      limits: {
        fileSize: config.upload.maxFileSize,
      },
      fileFilter: this.allowedTypesFilter,
    }).single(fieldName);
  }

  /**
   * Upload multiple files
   */
  static uploadFiles(fieldName: string = 'files', maxCount: number = 10) {
    return multer({
      storage: this.memoryStorage,
      limits: {
        fileSize: config.upload.maxFileSize,
      },
      fileFilter: this.allowedTypesFilter,
    }).array(fieldName, maxCount);
  }

  /**
   * Upload profile image (specific validation)
   */
  static uploadProfileImage() {
    return multer({
      storage: this.memoryStorage,
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB for profile images
      },
      fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
        if (allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new InvalidFileTypeError(allowedTypes));
        }
      },
    }).single('profileImage');
  }

  /**
   * Upload ID document (specific validation)
   */
  static uploadIdDocument() {
    return multer({
      storage: this.memoryStorage,
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB for ID documents
      },
      fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
        if (allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new InvalidFileTypeError(allowedTypes));
        }
      },
    }).single('idDocument');
  }

  /**
   * Upload selfie
   */
  static uploadSelfie() {
    return multer({
      storage: this.memoryStorage,
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
      },
      fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
        if (allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new InvalidFileTypeError(allowedTypes));
        }
      },
    }).single('selfie');
  }

  /**
   * Upload message attachments
   */
  static uploadMessageAttachments() {
    return multer({
      storage: this.memoryStorage,
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
      fileFilter: (req, file, cb) => {
        const allowedTypes = [
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/gif',
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];
        if (allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new InvalidFileTypeError(allowedTypes));
        }
      },
    }).array('attachments', 5);
  }

  /**
   * Upload multiple field types
   */
  static uploadFields(fields: { name: string; maxCount: number }[]) {
    return multer({
      storage: this.memoryStorage,
      limits: {
        fileSize: config.upload.maxFileSize,
      },
      fileFilter: this.allowedTypesFilter,
    }).fields(fields);
  }

  /**
   * Custom upload with options
   */
  static custom(options: {
    fieldName: string;
    maxSize?: number;
    allowedTypes?: string[];
    maxCount?: number;
    useMemoryStorage?: boolean;
  }) {
    const {
      fieldName,
      maxSize = config.upload.maxFileSize,
      allowedTypes = config.upload.allowedFileTypes,
      maxCount = 1,
      useMemoryStorage = true,
    } = options;

    const fileFilter = (req: Request, file: Express.Multer.File, cb: FileFilterCallback): void => {
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new InvalidFileTypeError(allowedTypes));
      }
    };

    const upload = multer({
      storage: useMemoryStorage ? this.memoryStorage : this.storage,
      limits: { fileSize: maxSize },
      fileFilter,
    });

    return maxCount === 1 ? upload.single(fieldName) : upload.array(fieldName, maxCount);
  }

  /**
   * Validate uploaded file exists
   */
  static validateFileExists(fieldName: string = 'file') {
    return (req: Request, res: any, next: any): void => {
      if (!req.file && !req.files) {
        throw new BadRequestError(`${fieldName} is required`);
      }
      next();
    };
  }

  /**
   * Validate file size
   */
  static validateFileSize(maxSize: number) {
    return (req: Request, res: any, next: any): void => {
      if (req.file && req.file.size > maxSize) {
        throw new FileSizeTooLargeError(maxSize);
      }

      if (req.files && Array.isArray(req.files)) {
        const oversizedFile = req.files.find((file) => file.size > maxSize);
        if (oversizedFile) {
          throw new FileSizeTooLargeError(maxSize);
        }
      }

      next();
    };
  }

  /**
   * Get file buffer from request
   */
  static getFileBuffer(req: Request): Buffer | null {
    return req.file?.buffer || null;
  }

  /**
   * Get multiple file buffers from request
   */
  static getFileBuffers(req: Request): Buffer[] {
    if (!req.files || !Array.isArray(req.files)) {
      return [];
    }
    return req.files.map((file) => file.buffer);
  }
}

// Export middleware functions — bound to UploadMiddleware so `this` works correctly
// when called as standalone functions (e.g. uploadProfileImage() in routes)
export const uploadImage = UploadMiddleware.uploadImage.bind(UploadMiddleware);
export const uploadImages = UploadMiddleware.uploadImages.bind(UploadMiddleware);
export const uploadDocument = UploadMiddleware.uploadDocument.bind(UploadMiddleware);
export const uploadDocuments = UploadMiddleware.uploadDocuments.bind(UploadMiddleware);
export const uploadVideo = UploadMiddleware.uploadVideo.bind(UploadMiddleware);
export const uploadFile = UploadMiddleware.uploadFile.bind(UploadMiddleware);
export const uploadFiles = UploadMiddleware.uploadFiles.bind(UploadMiddleware);
export const uploadProfileImage = UploadMiddleware.uploadProfileImage.bind(UploadMiddleware);
export const uploadIdDocument = UploadMiddleware.uploadIdDocument.bind(UploadMiddleware);
export const uploadSelfie = UploadMiddleware.uploadSelfie.bind(UploadMiddleware);
export const uploadMessageAttachments =
  UploadMiddleware.uploadMessageAttachments.bind(UploadMiddleware);
export const uploadFields = UploadMiddleware.uploadFields.bind(UploadMiddleware);

export default UploadMiddleware;
