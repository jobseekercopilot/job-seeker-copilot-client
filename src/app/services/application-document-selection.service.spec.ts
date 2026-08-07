import {HttpErrorResponse} from '@angular/common/http';
import {TestBed} from '@angular/core/testing';
import {of, throwError} from 'rxjs';
import {ApplicationDocumentSelectionControllerService} from '../api/document-generation-gateway';
import {
  ApplicationDocumentSelectionConflict,
  ApplicationDocumentSelectionService,
  type ApplicationSelectionRecord,
} from './application-document-selection.service';
import {BrowserSessionService} from './browser-session.service';

const APPLICATION_ID = 'c17442dd-c24f-48a2-86e5-b0ec7f38f8cb';
const CV_ID = '3b0f6a57-389d-4e20-a007-199afca04b20';
const COVER_LETTER_ID = '3b0f6a57-389d-4e20-a007-199afca04b21';
const CURRENT: ApplicationSelectionRecord = {
  id: APPLICATION_ID,
  status: 'DOCUMENTS_GENERATED',
  cvDocumentId: CV_ID,
  coverLetterDocumentId: COVER_LETTER_ID,
  version: 8,
};

describe('ApplicationDocumentSelectionService', () => {
  const ensureCsrf = vi.fn(() => of(undefined));
  const put = vi.fn((...arguments_: unknown[]) => {
    void arguments_;
    return of(CURRENT);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        ApplicationDocumentSelectionService,
        {provide: ApplicationDocumentSelectionControllerService, useValue: {save: put}},
        {provide: BrowserSessionService, useValue: {ensureCsrf}},
      ],
    });
  });

  it.each([
    ['none', {state: 'OMITTED'} as const, {state: 'OMITTED'} as const],
    ['CV only', {state: 'SELECTED', documentId: CV_ID} as const, {state: 'OMITTED'} as const],
    ['cover letter only', {state: 'OMITTED'} as const, {state: 'SELECTED', documentId: COVER_LETTER_ID} as const],
    ['both', {state: 'SELECTED', documentId: CV_ID} as const, {state: 'SELECTED', documentId: COVER_LETTER_ID} as const],
  ])('saves %s with one explicit request and stable idempotency key', (
    _label,
    cvSelection,
    coverLetterSelection,
  ) => {
    let result: ApplicationSelectionRecord | undefined;
    TestBed.inject(ApplicationDocumentSelectionService).saveSelections(
      APPLICATION_ID.toUpperCase(),
      {cvSelection, coverLetterSelection, expectedVersion: 7},
      ' selection-command-1 ',
    ).subscribe(value => result = value);

    expect(ensureCsrf).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledWith(
      APPLICATION_ID,
      'selection-command-1',
      {cvSelection, coverLetterSelection, expectedVersion: 7},
      'body',
      false,
      {transferCache: false},
    );
    expect(result).toEqual(CURRENT);
  });

  it('creates explicit selected and omitted slot values', () => {
    const service = TestBed.inject(ApplicationDocumentSelectionService);

    expect(service.selected(CV_ID.toUpperCase())).toEqual({
      state: 'SELECTED',
      documentId: CV_ID,
    });
    expect(service.omitted()).toEqual({state: 'OMITTED'});
  });

  it.each([
    ['bad application', 'not-an-id', {cvSelection: {state: 'OMITTED'} as const, coverLetterSelection: {state: 'OMITTED'} as const, expectedVersion: 0}, 'key-1'],
    ['bad document', APPLICATION_ID, {cvSelection: {state: 'SELECTED', documentId: 'bad'} as const, coverLetterSelection: {state: 'OMITTED'} as const, expectedVersion: 0}, 'key-1'],
    ['negative version', APPLICATION_ID, {cvSelection: {state: 'OMITTED'} as const, coverLetterSelection: {state: 'OMITTED'} as const, expectedVersion: -1}, 'key-1'],
    ['fractional version', APPLICATION_ID, {cvSelection: {state: 'OMITTED'} as const, coverLetterSelection: {state: 'OMITTED'} as const, expectedVersion: 1.5}, 'key-1'],
    ['bad key', APPLICATION_ID, {cvSelection: {state: 'OMITTED'} as const, coverLetterSelection: {state: 'OMITTED'} as const, expectedVersion: 0}, 'unsafe key'],
  ])('rejects %s before making a write', (_label, id, request, key) => {
    const service = TestBed.inject(ApplicationDocumentSelectionService);

    expect(() => service.saveSelections(id, request, key)).toThrow();
    expect(ensureCsrf).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('models a stale conflict with the authoritative current record', () => {
    put.mockReturnValueOnce(throwError(() => new HttpErrorResponse({
      status: 409,
      error: {
        status: 409,
        message: 'The application changed',
        currentApplication: CURRENT,
      },
    })));
    let conflict: unknown;

    TestBed.inject(ApplicationDocumentSelectionService).saveSelections(
      APPLICATION_ID,
      {
        cvSelection: {state: 'OMITTED'},
        coverLetterSelection: {state: 'OMITTED'},
        expectedVersion: 7,
      },
      'stale-command',
    ).subscribe({error: error => conflict = error});

    expect(conflict).toBeInstanceOf(ApplicationDocumentSelectionConflict);
    expect((conflict as ApplicationDocumentSelectionConflict).currentApplication)
      .toEqual(CURRENT);
  });

  it('does not misclassify an unsafe conflict body as authoritative', () => {
    const response = new HttpErrorResponse({
      status: 409,
      error: {status: 409, currentApplication: {version: 9}},
    });
    put.mockReturnValueOnce(throwError(() => response));
    let failure: unknown;

    TestBed.inject(ApplicationDocumentSelectionService).saveSelections(
      APPLICATION_ID,
      {
        cvSelection: {state: 'OMITTED'},
        coverLetterSelection: {state: 'OMITTED'},
        expectedVersion: 7,
      },
      'stale-command',
    ).subscribe({error: error => failure = error});

    expect(failure).toBe(response);
  });
});
