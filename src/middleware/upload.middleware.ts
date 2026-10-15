import multer from 'multer';
import { config } from '@/config/env';

/** Files are kept in memory only long enough to validate magic bytes and push to private storage. Nothing touches local disk. */
const mem = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.upload.maxFileSize, files: 6, fields: 20, parts: 30 } });

export const uploadSingle = (field: string) => mem.single(field);
export const uploadFields = (fields: string[]) => mem.fields(fields.map((name) => ({ name, maxCount: 1 })));
export const uploadMany = (field: string, max = 5) => mem.array(field, max);
