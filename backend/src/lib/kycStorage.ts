import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './x402.js';

/**
 * Encrypted-at-rest storage for KYC documents (AES-256-GCM).
 * File layout: [12-byte IV][16-byte auth tag][ciphertext]. Files live under
 * KYC_UPLOAD_DIR (default backend/uploads/kyc, git-ignored) with random names.
 */
const UPLOAD_DIR = path.resolve(process.env.KYC_UPLOAD_DIR || 'uploads/kyc');
export const MAX_DOC_BYTES = 5 * 1024 * 1024;

function key(): Buffer {
  const hex = process.env.KYC_ENCRYPTION_KEY || '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new HttpError(503, 'KYC uploads are not configured: set KYC_ENCRYPTION_KEY (openssl rand -hex 32) in backend/.env', 'KYC_NOT_CONFIGURED');
  }
  return Buffer.from(hex, 'hex');
}

/** Detects the real file type from its first bytes (never trust the browser's mime type). */
export function sniffDocumentType(buf: Buffer): 'application/pdf' | 'image/jpeg' | 'image/png' | null {
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

export async function storeEncrypted(data: Buffer): Promise<string> {
  const k = key();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const name = `${crypto.randomUUID()}.enc`;
  await mkdir(UPLOAD_DIR, { recursive: true, mode: 0o700 });
  await writeFile(path.join(UPLOAD_DIR, name), Buffer.concat([iv, cipher.getAuthTag(), ciphertext]), { mode: 0o600 });
  return name;
}

export async function readDecrypted(name: string): Promise<Buffer> {
  if (!/^[0-9a-f-]{36}\.enc$/.test(name)) throw new HttpError(400, 'Invalid document reference');
  const blob = await readFile(path.join(UPLOAD_DIR, name));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}
