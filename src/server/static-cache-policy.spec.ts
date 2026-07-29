import {describe, expect, it, vi} from 'vitest';
import {setStaticAssetCacheHeaders} from './static-cache-policy';

describe('static asset cache policy', () => {
  it('never caches prerendered route HTML', () => {
    const setHeader = vi.fn();

    setStaticAssetCacheHeaders(
      {setHeader},
      '/app/dist/browser/dashboard/index.html',
    );

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('caches fingerprinted build assets immutably', () => {
    const setHeader = vi.fn();

    setStaticAssetCacheHeaders(
      {setHeader},
      '/app/dist/browser/main-MUTWPYFR.js',
    );

    expect(setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'public, max-age=31536000, immutable',
    );
  });

  it('uses a short cache for static assets without a content fingerprint', () => {
    const setHeader = vi.fn();

    setStaticAssetCacheHeaders(
      {setHeader},
      '/app/dist/browser/brand/jobseeker-copilot-logo.svg',
    );

    expect(setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'public, max-age=3600',
    );
  });
});
