import type { RequestHandler } from 'express';

export const BETA_DISABLED_API_PREFIXES: string[] = [
  '/api/jobs',
  '/api/v1/applications',
  '/api/v1/document-generation',
  '/api/v1/documents',
  '/api/v1/reports',
  '/api/v1/payment',
];

export const rejectBetaDisabledCapability: RequestHandler = (_request, response) => {
  response.status(404).json({
    error: 'FEATURE_NOT_AVAILABLE',
    message: 'This capability is not available in the User Management beta',
  });
};
