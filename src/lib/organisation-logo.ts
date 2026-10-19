export const ORGANISATION_LOGO_BUCKET = "organisation-logos";
export const ORGANISATION_LOGO_LIMIT = 2 * 1024 * 1024;
export const ORGANISATION_LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
export const ORGANISATION_LOGO_ERROR = "Use a PNG, JPEG, WebP, or GIF up to 2 MB.";

export function organisationLogoPath(organisationId: string) {
  return `${organisationId}/logo`;
}

export function organisationLogoUrl(organisationId: string, updatedAt: string) {
  return `/organisation-logo/${organisationId}?v=${encodeURIComponent(updatedAt)}`;
}

export function organisationSnapshotPath(organisationId: string, headerId: string) {
  return `${organisationId}/snapshots/${headerId}`;
}

export function organisationObjectUrl(organisationId: string, objectPath: string, version: string) {
  const object = objectPath.startsWith(`${organisationId}/`)
    ? objectPath.slice(organisationId.length + 1)
    : objectPath;
  return `/organisation-logo/${organisationId}?object=${encodeURIComponent(object)}&v=${encodeURIComponent(version)}`;
}

export function logoContentType(bytes: Uint8Array) {
  if (bytes.byteLength < 12 || bytes.byteLength > ORGANISATION_LOGO_LIMIT) return null;
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
