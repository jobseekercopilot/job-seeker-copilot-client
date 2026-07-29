import {HttpClient} from '@angular/common/http';
import {TestBed} from '@angular/core/testing';
import {of} from 'rxjs';
import {
  DocumentEvidenceSelectionPurposeEnum,
  DocumentEvidenceSelectionSectionOrderEnum,
  DocumentGenerationControllerService,
} from '../api/document-generation-gateway';
import {SavedJobsService} from '../api/job-finder';
import {Job} from '../models/job-search.model';
import {BrowserSessionService} from './browser-session.service';
import {
  DocumentGenerationService,
  GenerationEvidenceSelection,
} from './document-generation.service';

describe('DocumentGenerationService', () => {
  it('refreshes CSRF before saving the selected job and starting generation', () => {
    const calls: string[] = [];
    const refreshCsrf = vi.fn(() => {
      calls.push('csrf');
      return of(undefined);
    });
    const save = vi.fn(() => {
      calls.push('save');
      return of({savedJobId: 'saved-job-1'});
    });
    const startOperation = vi.fn(() => {
      calls.push('start');
      return of({
        state: 'AWAITING_APPROVAL',
        operationId: 'operation-1',
        cvDocumentId: 'cv-1',
        coverLetterDocumentId: 'cover-letter-1',
      });
    });
    const approveOperation = vi.fn(() => {
      calls.push('approve');
      return of({
        state: 'COMPLETED',
        applicationId: 'application-1',
        cvDocumentId: 'cv-1',
        coverLetterDocumentId: 'cover-letter-1',
        downloads: {},
      });
    });

    TestBed.configureTestingModule({
      providers: [
        DocumentGenerationService,
        {provide: BrowserSessionService, useValue: {refreshCsrf}},
        {provide: SavedJobsService, useValue: {save}},
        {
          provide: DocumentGenerationControllerService,
          useValue: {startOperation, approveOperation},
        },
        {provide: HttpClient, useValue: {}},
      ],
    });

    const job = {
      id: 'job-1',
      title: 'Software Engineer',
      company: 'Example Ltd',
      description: 'Build accessible software.',
    } as Job;
    const evidence: GenerationEvidenceSelection = {
      cv: {
        entryIds: ['evidence-1'],
        sectionOrder: [DocumentEvidenceSelectionSectionOrderEnum.Employment],
      },
      coverLetter: {
        entryIds: ['evidence-1'],
        sectionOrder: [DocumentEvidenceSelectionSectionOrderEnum.Employment],
      },
    };

    TestBed.inject(DocumentGenerationService).generate(job, evidence).subscribe(response => {
      expect(response.applicationId).toBe('application-1');
    });

    expect(refreshCsrf).toHaveBeenCalledOnce();
    expect(calls).toEqual(['csrf', 'save', 'start', 'approve']);
    expect(startOperation).toHaveBeenCalledWith(
      'saved-job-1',
      expect.stringMatching(/^browser-/),
      {
        documents: [
          {
            purpose: DocumentEvidenceSelectionPurposeEnum.Cv,
            entryIds: ['evidence-1'],
            sectionOrder: [DocumentEvidenceSelectionSectionOrderEnum.Employment],
          },
          {
            purpose: DocumentEvidenceSelectionPurposeEnum.CoverLetter,
            entryIds: ['evidence-1'],
            sectionOrder: [DocumentEvidenceSelectionSectionOrderEnum.Employment],
          },
        ],
      },
      'body',
      false,
      {transferCache: false},
    );
  });
});
