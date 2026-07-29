interface HeaderResponse {
  setHeader(name: string, value: string): unknown;
}

const FINGERPRINTED_ASSET = /-[a-z0-9]{8,}\.[^.]+$/i;

export function setStaticAssetCacheHeaders(
  response: HeaderResponse,
  filePath: string,
): void {
  if (filePath.toLowerCase().endsWith('.html')) {
    response.setHeader('Cache-Control', 'no-store');
    return;
  }

  if (FINGERPRINTED_ASSET.test(filePath)) {
    response.setHeader(
      'Cache-Control',
      'public, max-age=31536000, immutable',
    );
    return;
  }

  response.setHeader('Cache-Control', 'public, max-age=3600');
}
