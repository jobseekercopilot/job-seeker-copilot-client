import type {Express, Request, Response} from 'express';
import {downstreamFailureResponse} from './bff-boundary';
import {callUserManagement} from './user-management-proxy';

type EvidenceMethod = 'GET' | 'POST' | 'PUT';

export interface UserManagementEvidenceConfig {
  origin: string;
  timeoutMs: number;
}

export function registerUserManagementEvidenceRoutes(
  app: Express,
  config: UserManagementEvidenceConfig,
  fetchImplementation: typeof fetch = fetch,
): void {
  const forward = (method: EvidenceMethod) =>
    async (request: Request, response: Response): Promise<void> => {
      try {
        const result = await callUserManagement(
          config.origin,
          request.originalUrl,
          method,
          request.headers,
          request.body,
          config.timeoutMs,
          fetchImplementation,
        );

        response.setHeader('Cache-Control', result.cacheControl);
        response.status(result.status).type(result.contentType).send(result.body);
      } catch (error: unknown) {
        const failure = downstreamFailureResponse(error);
        console.error('BFF downstream request failed', {
          service: 'user-management-evidence',
          category: failure.category,
        });
        response.status(failure.statusCode).json({
          statusCode: failure.statusCode,
          success: false,
          message: failure.message,
        });
      }
    };

  app.get('/api/auth/evidence', forward('GET'));
  app.post('/api/auth/evidence', forward('POST'));
  app.get('/api/auth/evidence/:entryId', forward('GET'));
  app.put('/api/auth/evidence/:entryId', forward('PUT'));

  for (const action of ['archive', 'confirm', 'hide', 'restore', 'show', 'supersede']) {
    app.post(`/api/auth/evidence/:entryId/${action}`, forward('POST'));
  }
}
