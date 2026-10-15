/**
 * Magic-byte validation for uploads. The client-supplied MIME type is never
 * trusted: the detected type must match what was declared and be allowed.
 */
export type DetectedMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

export function detectMime(buf: Buffer): DetectedMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP')
    return 'image/webp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

export interface UploadPolicy {
  allowed: readonly DetectedMime[];
  maxBytes: number;
}

export const KYC_UPLOAD_POLICY: UploadPolicy = {
  allowed: ['image/jpeg', 'image/png', 'application/pdf'],
  maxBytes: 8 * 1024 * 1024,
};
export const IMAGE_UPLOAD_POLICY: UploadPolicy = {
  allowed: ['image/jpeg', 'image/png', 'image/webp'],
  maxBytes: 5 * 1024 * 1024,
};
export const EVIDENCE_UPLOAD_POLICY: UploadPolicy = {
  allowed: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  maxBytes: 8 * 1024 * 1024,
};

export class UploadValidationError extends Error {}

export function validateUpload(buf: Buffer, declaredMime: string, policy: UploadPolicy): DetectedMime {
  if (buf.length === 0) throw new UploadValidationError('File is empty');
  if (buf.length > policy.maxBytes) {
    throw new UploadValidationError(`File exceeds the ${Math.round(policy.maxBytes / 1024 / 1024)} MB limit`);
  }
  const detected = detectMime(buf);
  if (!detected) throw new UploadValidationError('Unrecognised or unsupported file type');
  if (!policy.allowed.includes(detected)) throw new UploadValidationError(`File type ${detected} is not allowed here`);
  const declared = declaredMime === 'image/jpg' ? 'image/jpeg' : declaredMime;
  if (declared !== detected) throw new UploadValidationError('File content does not match its declared type');
  return detected;
}
