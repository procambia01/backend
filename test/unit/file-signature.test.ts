import { validateUpload, KYC_UPLOAD_POLICY, IMAGE_UPLOAD_POLICY, UploadValidationError } from '@/lib/file-signature';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const PDF = Buffer.from('%PDF-1.7\n%%EOF');
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);

describe('upload validation (magic bytes, not client MIME)', () => {
  it('accepts genuine PNG / JPEG / PDF for KYC', () => {
    expect(validateUpload(PNG, 'image/png', KYC_UPLOAD_POLICY)).toBe('image/png');
    expect(validateUpload(JPG, 'image/jpeg', KYC_UPLOAD_POLICY)).toBe('image/jpeg');
    expect(validateUpload(PDF, 'application/pdf', KYC_UPLOAD_POLICY)).toBe('application/pdf');
  });
  it('rejects an executable renamed to .jpg with a lying Content-Type', () => {
    expect(() => validateUpload(EXE, 'image/jpeg', KYC_UPLOAD_POLICY)).toThrow(UploadValidationError);
  });
  it('rejects a declared type that disagrees with the real content', () => {
    expect(() => validateUpload(PNG, 'image/jpeg', KYC_UPLOAD_POLICY)).toThrow(UploadValidationError);
  });
  it('rejects types outside the policy (PDF as avatar)', () => {
    expect(() => validateUpload(PDF, 'application/pdf', IMAGE_UPLOAD_POLICY)).toThrow(UploadValidationError);
  });
  it('rejects empty and oversized files', () => {
    expect(() => validateUpload(Buffer.alloc(0), 'image/png', KYC_UPLOAD_POLICY)).toThrow(UploadValidationError);
    expect(() => validateUpload(Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)]), 'image/png', KYC_UPLOAD_POLICY)).toThrow(UploadValidationError);
  });
  it('rejects SVG / HTML (script-capable) even with an image Content-Type', () => {
    expect(() => validateUpload(Buffer.from('<svg onload=alert(1)>'), 'image/png', IMAGE_UPLOAD_POLICY)).toThrow(UploadValidationError);
  });
});
