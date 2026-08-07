import {TestBed} from '@angular/core/testing';
import {firstValueFrom, of} from 'rxjs';
import {
  DocumentLifecycleControllerService,
  DocumentVersionLifecycleResponse,
} from '../api/document-generation-gateway';
import {BrowserSessionService} from './browser-session.service';
import {
  associatedDocumentCopy,
  deleteDocumentCopy,
  deletedDocumentCopy,
  DOCUMENT_LIFECYCLE_COPY,
  DocumentLifecycleService,
} from './document-lifecycle.service';

describe('document lifecycle policy copy', () => {
  it('uses the server-supplied recovery deadline without calculating another date', () => {
    const deadline = '06 September 2026 at 09:30';

    expect(deleteDocumentCopy(deadline)).toContain(deadline);
    expect(deletedDocumentCopy(deadline)).toContain(deadline);
    expect(deleteDocumentCopy(deadline)).toContain('Files will not be available');
    expect(deletedDocumentCopy(deadline)).toContain('will not select it as your current document');
  });

  it('distinguishes draft selections from immutable submitted uses', () => {
    const warning = associatedDocumentCopy([
      {associationState: 'DRAFT_SELECTED'},
      {associationState: 'DRAFT_SELECTED'},
      {associationState: 'FROZEN_USED'},
    ]);

    expect(warning).toContain('2 draft applications');
    expect(warning).toContain('1 submitted application');
    expect(warning).toContain('Archive is recommended');
    expect(warning).toContain('will not switch');
  });

  it('publishes truthful archive, permanent deletion and tombstone language', () => {
    expect(DOCUMENT_LIFECYCLE_COPY.archive).toContain('restore it later');
    expect(DOCUMENT_LIFECYCLE_COPY.irreversibleDeletion).toContain('required retention checks');
    expect(DOCUMENT_LIFECYCLE_COPY.purged).toContain('exact version and application history');
  });
});

describe('DocumentLifecycleService', () => {
  const lifecycle = {
    id: '3b0f6a57-389d-4e20-a007-199afca04b20',
    retentionState: 'ARCHIVED',
  } satisfies DocumentVersionLifecycleResponse;
  const api = {
    associations: vi.fn(() => of({associations: []})),
    archive: vi.fn(() => of(lifecycle)),
    restore: vi.fn(() => of({...lifecycle, retentionState: 'AVAILABLE'})),
    _delete: vi.fn(() => of({...lifecycle, retentionState: 'DELETED'})),
  };
  const browserSession = {
    ensureCsrf: vi.fn(() => of({name: 'X-CSRF-Token', value: 'safe'})),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        DocumentLifecycleService,
        {provide: DocumentLifecycleControllerService, useValue: api},
        {provide: BrowserSessionService, useValue: browserSession},
      ],
    });
  });

  it('reads owner-scoped associations without requiring a write token', async () => {
    const service = TestBed.inject(DocumentLifecycleService);

    await firstValueFrom(service.associations(lifecycle.id as string));

    expect(browserSession.ensureCsrf).not.toHaveBeenCalled();
    expect(api.associations).toHaveBeenCalledWith(
      lifecycle.id,
      'body',
      false,
      {transferCache: false},
    );
  });

  it.each([
    ['archive', api.archive],
    ['restore', api.restore],
  ] as const)('bootstraps CSRF before %s', async (action, expectedCall) => {
    const service = TestBed.inject(DocumentLifecycleService);

    await firstValueFrom(service[action](lifecycle.id as string));

    expect(browserSession.ensureCsrf).toHaveBeenCalledOnce();
    expect(expectedCall).toHaveBeenCalledWith(
      lifecycle.id,
      'body',
      false,
      {transferCache: false},
    );
  });

  it('bootstraps CSRF before recoverable deletion', async () => {
    const service = TestBed.inject(DocumentLifecycleService);

    await firstValueFrom(service.delete(lifecycle.id as string));

    expect(browserSession.ensureCsrf).toHaveBeenCalledOnce();
    expect(api._delete).toHaveBeenCalledWith(
      lifecycle.id,
      'body',
      false,
      {transferCache: false},
    );
  });
});
