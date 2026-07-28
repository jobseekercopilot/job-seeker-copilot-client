import type {RequestHandler} from 'express';

export const UNAVAILABLE_API_PREFIXES: string[] = [
  '/api/v1/payment',
];

export const rejectUnavailableCapability: RequestHandler = (_request, response) => {
  response.status(404).json({
    error: 'FEATURE_NOT_AVAILABLE',
    message: 'This capability is not currently available',
  });
};
