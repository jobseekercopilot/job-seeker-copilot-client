import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { JobCardComponent } from './job-card.component';
import { Job } from '../../models/job-search.model';
import { DownloadFileResponse } from '../../api/document-generation-gateway';
import {
  JobDescriptionCompletenessEnum,
  JobDiscoveryAssessmentAvailabilityEnum,
  JobDiscoveryAssessmentEngagementTypeEnum,
  JobDiscoveryAssessmentOccupationFamilyEnum,
  JobDiscoveryAssessmentSeniorityEnum,
  JobDiscoveryAssessmentTargetRoleAlignmentEnum,
  JobSalaryPeriodCodeEnum,
  JobSpecialistTypeEnum,
  MatchAssessmentProvenanceEnum,
  MatchAssessmentRatingEnum,
  MatchReasonSeverityEnum,
  MatchReasonStatusEnum,
} from '../../api/job-finder';
import { GenerationDownloadsResponse } from '../../services/document-generation.service';

describe('JobCardComponent', () => {
  const job: Job = {
    id: 'job-1',
    title: 'Developer',
    company: 'Example Ltd',
    location: 'Remote',
    salary: { min: 30000, max: 40000, currency: 'GBP' },
    postedDate: '2026-06-25',
    description: 'Build useful things.',
    url: 'https://example.com/job-1',
  };

  const downloads: GenerationDownloadsResponse = {
    cv: {
      docx: { fileId: 'cv-docx', fileName: 'Bernard McGeever CV.docx', downloadUrl: '/api/v1/document-generation/files/cv-docx/download' },
      pdf: { fileId: 'cv-pdf', fileName: 'Bernard McGeever CV.pdf', downloadUrl: '/api/v1/document-generation/files/cv-pdf/download' },
    },
    coverLetter: {
      docx: { fileId: 'letter-docx', fileName: 'Cover Letter.docx', downloadUrl: '/api/v1/document-generation/files/letter-docx/download' },
      pdf: { fileId: 'letter-pdf', fileName: 'Cover Letter.pdf', downloadUrl: '/api/v1/document-generation/files/letter-pdf/download' },
    },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JobCardComponent],
    }).compileComponents();
  });

  it('shows the generate button before generation', () => {
    const fixture = createFixture({
      job: {...job, canonicalJobId: 'reed:123', primarySource: 'REED'},
    });
    expandCard(fixture);

    expect(fixture.nativeElement.textContent).toContain('Generate CV & Cover Letter');
    expect(fixture.nativeElement.textContent).toContain('Not saved');
    expect(fixture.nativeElement.getAttribute('data-job-reference')).toBe('reed:123');
    expect(fixture.nativeElement.getAttribute('data-job-provider')).toBe('REED');
  });

  it('shows an explainable deterministic match and keeps unverified gates explicit', () => {
    const fixture = createFixture({
      job: {
        ...job,
        matchScore: 0.82,
        matchAssessment: {
          score: 0.82,
          provenance: MatchAssessmentProvenanceEnum.DeterministicProfile,
          algorithmVersion: 'PROFILE_MATCH_V1',
          targetRole: 'Software developer',
          rating: MatchAssessmentRatingEnum.Strong,
          candidateProfileUsed: true,
          components: [{
            code: 'SKILLS',
            score: 32,
            maximumScore: 40,
            explanation: 'Java and Spring overlap with the advert.',
          }],
          reasons: [{
            code: 'SKILL_OVERLAP',
            severity: MatchReasonSeverityEnum.Positive,
            status: MatchReasonStatusEnum.Met,
            explanation: 'Confirmed Java and Spring skills match this role.',
          }],
          hardGateReasons: [{
            code: 'RIGHT_TO_WORK',
            severity: MatchReasonSeverityEnum.Info,
            status: MatchReasonStatusEnum.Unverified,
            explanation: 'Right-to-work requirement must be confirmed by you.',
          }],
        },
        discoveryAssessment: {
          algorithmVersion: 'DISCOVERY_RULES_V1',
          availability: JobDiscoveryAssessmentAvailabilityEnum.OpenAtRetrieval,
          engagementType: JobDiscoveryAssessmentEngagementTypeEnum.Vacancy,
          occupationFamily: JobDiscoveryAssessmentOccupationFamilyEnum.Software,
          seniority: JobDiscoveryAssessmentSeniorityEnum.Mid,
          targetRoleAlignment: JobDiscoveryAssessmentTargetRoleAlignmentEnum.Aligned,
          excluded: false,
          exclusionReasons: [],
        },
      },
    });

    expect(fixture.debugElement.query(By.css('[data-testid="job-match-score"]')).nativeElement.textContent)
      .toContain('82% strong');
    expect(fixture.debugElement.query(By.css('[data-testid="job-discovery-status"]')).nativeElement.textContent)
      .toContain('Open when retrieved · mid');

    expandCard(fixture);

    const explanation = fixture.debugElement.query(By.css('[data-testid="job-match-explanation"]'))
      .nativeElement as HTMLElement;
    expect(explanation.textContent).toContain('Explainable profile match');
    expect(explanation.textContent).toContain('deterministic rules, not an AI opinion');
    expect(explanation.textContent).toContain('Confirmed Java and Spring skills match this role.');
    expect(explanation.textContent).toContain('Right-to-work requirement must be confirmed by you.');
  });

  it('does not invent a match explanation when the backend did not assess the job', () => {
    const fixture = createFixture({job: {...job, matchScore: 0.85}});

    expect(fixture.debugElement.query(By.css('[data-testid="job-match-score"]'))).toBeNull();
    expandCard(fixture);
    expect(fixture.debugElement.query(By.css('[data-testid="job-match-explanation"]'))).toBeNull();
  });

  it('labels query-only scoring as title alignment rather than a personal match', () => {
    const fixture = createFixture({
      job: {
        ...job,
        matchScore: 1,
        matchAssessment: {
          score: 1,
          provenance: MatchAssessmentProvenanceEnum.DeterministicQueryOnly,
          algorithmVersion: 'PROFILE_MATCH_V1',
          targetRole: 'Software engineer',
          rating: MatchAssessmentRatingEnum.Strong,
          candidateProfileUsed: false,
          components: [],
          reasons: [{
            code: 'PROFILE_EVIDENCE_NOT_SUPPLIED',
            severity: MatchReasonSeverityEnum.Info,
            status: MatchReasonStatusEnum.Unverified,
            explanation: 'This is query-title relevance only.',
          }],
          hardGateReasons: [],
        },
      },
    });

    expect(fixture.nativeElement.textContent).toContain('100% title alignment');
    expect(fixture.nativeElement.textContent).not.toContain('100% strong');
    expandCard(fixture);
    expect(fixture.nativeElement.textContent).toContain('Query-only estimate');
    expect(fixture.nativeElement.textContent).toContain('Why this advert matches your search');
    expect(fixture.nativeElement.textContent).not.toContain('Why this job matches your profile');
  });

  it('shows a saved job accurately and still allows document generation', () => {
    const fixture = createFixture({
      job: {...job, applicationId: 'app-1', applicationStatus: 'SAVED'},
    });
    expandCard(fixture);

    expect(fixture.nativeElement.textContent).toContain('Saved to applications');
    expect(fixture.nativeElement.textContent).toContain('Generate CV & Cover Letter');
    expect(fixture.nativeElement.textContent).not.toContain('Add to My Applications');

    openStatusMenu(fixture);
    expect(fixture.nativeElement.textContent).toContain('Mark as Applied');
  });

  it('keeps document generation disabled while identifying application tracking as available', () => {
    const fixture = createFixture({ applicationToolsAvailable: false });
    expandCard(fixture);
    const button: HTMLButtonElement = fixture.debugElement
      .queryAll(By.css('button'))
      .find(candidate => candidate.nativeElement.textContent.includes('CV & Cover Letter unavailable'))!
      .nativeElement;

    expect(button.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain(
      'Application tracking is available. CV and cover-letter generation is not enabled in this environment.',
    );
  });

  it('shows the loading state and disables generation while generating', () => {
    const fixture = createFixture({ generating: true });
    expandCard(fixture);
    const progress: HTMLElement = fixture.debugElement
      .query(By.css('[data-testid="generation-progress"]'))
      .nativeElement;
    const button: HTMLButtonElement = fixture.debugElement
      .queryAll(By.css('button'))
      .find(candidate => candidate.nativeElement.textContent.includes('Generating CV & Cover Letter'))!
      .nativeElement;

    expect(fixture.nativeElement.textContent).toContain('Generating CV & Cover Letter...');
    expect(progress.textContent).toContain('Generating');
    expect(progress.getAttribute('role')).toBe('status');
    expect(progress.getAttribute('aria-live')).toBe('polite');
    expect(progress.querySelector('.generation-spinner')?.getAttribute('aria-hidden')).toBe('true');
    expect(fixture.nativeElement.textContent).not.toContain('Processing');
    expect(button.disabled).toBe(true);
  });

  it('keeps cancellation visible while processing and emits it only when available', () => {
    const fixture = createFixture({generating: true});
    const emitted: Job[] = [];
    fixture.componentInstance.cancelGeneration.subscribe(selected => emitted.push(selected));
    const cancelButton: HTMLButtonElement = fixture.debugElement
      .query(By.css('[data-testid="cancel-generation-button"]'))
      .nativeElement;

    expect(cancelButton.getAttribute('aria-label')).toBe('Cancel document generation');
    expect(cancelButton.getAttribute('title')).toBe('Cancel generation');
    expect(cancelButton.disabled).toBe(false);
    cancelButton.click();

    expect(emitted).toEqual([job]);

    fixture.componentRef.setInput('cancellingGeneration', true);
    fixture.detectChanges();
    const cancellingButton: HTMLButtonElement = fixture.debugElement
      .query(By.css('[data-testid="cancel-generation-button"]'))
      .nativeElement;
    cancellingButton.click();

    expect(cancellingButton.disabled).toBe(true);
    expect(cancellingButton.getAttribute('aria-label')).toBe('Cancelling document generation');
    expect(fixture.debugElement.query(By.css('[data-testid="generation-progress"]')).nativeElement.textContent)
      .toContain('Cancelling');
    expect(emitted).toEqual([job]);
  });

  it('shows the success panel and four download buttons after generation', () => {
    const fixture = createFixture({ downloads });
    expandCard(fixture);
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .map(button => button.textContent?.trim())
      .filter((text): text is string => Boolean(text));

    expect(fixture.nativeElement.textContent).toContain('CV and Cover Letter generated successfully');
    expect(fixture.nativeElement.textContent).not.toContain('Generate CV & Cover Letter');
    expect(buttons.filter(text => text.includes('Download DOCX'))).toHaveLength(2);
    expect(buttons.filter(text => text.includes('Download PDF'))).toHaveLength(2);
  });

  it('emits the selected download file when a download button is clicked', () => {
    const fixture = createFixture({ downloads });
    expandCard(fixture);
    const emitted: DownloadFileResponse[] = [];
    fixture.componentInstance.downloadFile.subscribe(file => emitted.push(file));

    const downloadButton: HTMLButtonElement = fixture.debugElement
      .queryAll(By.css('button'))
      .find(button => button.nativeElement.textContent.includes('Download DOCX'))!
      .nativeElement;
    downloadButton.click();

    expect(emitted).toEqual([downloads.cv!.docx!]);
  });

  it('shows a dismissible generation error', () => {
    const fixture = createFixture({ generationError: 'Generation failed. Please try again.' });
    expandCard(fixture);
    const dismissed: string[] = [];
    fixture.componentInstance.dismissGenerationError.subscribe(jobId => dismissed.push(jobId));

    const dismissButton: HTMLButtonElement = fixture.debugElement
      .query(By.css('button[aria-label="Dismiss generation error"]'))
      .nativeElement;
    dismissButton.click();

    expect(fixture.nativeElement.textContent).toContain('Generation failed. Please try again.');
    expect(dismissed).toEqual(['job-1']);
  });

  it('shows a fallback when the posted date is invalid', () => {
    const fixture = createFixture({ job: { ...job, postedDate: 'not-a-date' } });

    expect(fixture.nativeElement.textContent).toContain('Posted date unavailable');
  });

  it('labels and explains an apprenticeship while preserving all advertised locations', () => {
    const fixture = createFixture({
      job: {
        ...job,
        specialistType: JobSpecialistTypeEnum.Apprenticeship,
        locations: [
          {displayName: 'Leeds, LS1 2AB'},
          {displayName: 'Bradford, BD1 1AA'},
        ],
        salary: {minimum: 15000, currencyCode: 'GBP', periodCode: JobSalaryPeriodCodeEnum.Year},
        apprenticeshipDetails: {
          courseTitle: 'Software developer (level 4)',
          apprenticeshipLevel: 'Higher',
          trainingProvider: 'Example Training Provider',
          duration: '18 months',
          hoursPerWeek: 37.5,
          startDate: '2026-10-01',
          numberOfPositions: 2,
        },
      },
    });

    expect(fixture.debugElement.query(By.css('[data-testid="specialist-job-badge"]')).nativeElement.textContent)
      .toContain('Apprenticeship');
    expect(fixture.nativeElement.textContent).toContain('GBP 15,000 per year');

    expandCard(fixture);
    const details = fixture.debugElement.query(By.css('[data-testid="apprenticeship-details"]')).nativeElement;
    expect(details.textContent).toContain('Software developer (level 4)');
    expect(details.textContent).toContain('Example Training Provider');
    expect(details.textContent).toContain('Leeds, LS1 2AB');
    expect(details.textContent).toContain('Bradford, BD1 1AA');
  });

  it('labels an NHS specialist vacancy', () => {
    const fixture = createFixture({job: {...job, specialistType: JobSpecialistTypeEnum.Nhs}});
    expect(fixture.debugElement.query(By.css('[data-testid="specialist-job-badge"]')).nativeElement.textContent)
      .toContain('NHS vacancy');
  });

  it('attributes Google Maps commute content in the same job metadata container', () => {
    const fixture = createFixture({
      job: {
        ...job,
        commuteAssessment: {
          status: 'WITHIN_PREFERENCE',
          bestSuitableMode: 'DRIVE',
          providerAttribution: 'GOOGLE_MAPS',
          modes: [{mode: 'DRIVE', durationMinutes: 37, outcome: 'WITHIN'}],
        },
      } as Job,
    });

    const estimate = fixture.debugElement.query(By.css('[data-testid="commute-assessment"]'));
    const attribution: HTMLElement = fixture.debugElement
      .query(By.css('[data-testid="commute-google-maps-attribution"]')).nativeElement;

    expect(estimate.nativeElement.textContent).toContain('About 37 min by driving');
    expect(attribution.textContent).toContain('Google Maps');
    expect(attribution.getAttribute('translate')).toBe('no');
    expect(estimate.nativeElement.contains(attribution)).toBe(true);
  });

  it('does not attribute non-Google commute content to Google Maps', () => {
    const fixture = createFixture({
      job: {
        ...job,
        commuteAssessment: {
          status: 'UNAVAILABLE',
          providerAttribution: undefined,
          modes: [],
        },
      } as Job,
    });

    expect(fixture.debugElement.query(
      By.css('[data-testid="commute-google-maps-attribution"]'),
    )).toBeNull();
  });

  it('shows a bounded accessible description preview and restores it after expanding', () => {
    const tail = 'FINAL REQUIREMENT THAT MUST ONLY APPEAR AFTER EXPANSION';
    const description = `${'Build accessible services with a collaborative delivery team. '.repeat(12)}${tail}`;
    const fixture = createFixture({ job: { ...job, description } });
    expandCard(fixture);

    const descriptionElement: HTMLElement = fixture.debugElement
      .query(By.css('.job-description'))
      .nativeElement;
    const toggle: HTMLButtonElement = fixture.debugElement
      .query(By.css('.description-toggle'))
      .nativeElement;

    expect(descriptionElement.textContent).toContain('Build accessible services');
    expect(descriptionElement.textContent).not.toContain(tail);
    expect(descriptionElement.textContent).toContain('…');
    expect(toggle.textContent).toContain('Read more');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(descriptionElement.id);
    expect(descriptionElement.id).toBe('job-card-job-1-description');

    toggle.click();
    fixture.detectChanges();

    expect(descriptionElement.textContent).toContain(tail);
    expect(toggle.textContent).toContain('Show less');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    toggle.click();
    fixture.detectChanges();

    expect(descriptionElement.textContent).not.toContain(tail);
    expect(toggle.textContent).toContain('Read more');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows short descriptions without an unnecessary expansion control and preserves newlines', () => {
    const fixture = createFixture({
      job: { ...job, description: 'First line\r\nSecond line\nThird line' },
    });
    expandCard(fixture);

    expect(fixture.componentInstance.fullDescription()).toBe('First line\nSecond line\nThird line');
    expect(fixture.debugElement.query(By.css('.job-description')).nativeElement.textContent)
      .toContain('First line\nSecond line\nThird line');
    expect(fixture.debugElement.query(By.css('.description-toggle'))).toBeNull();
  });

  it('keeps long provider content inside a narrow job card while retaining the full text', () => {
    const longTitle = 'SeniorSoftwarePlatformAccessibilityEngineer'.repeat(4);
    const longCompany = 'ExampleInternationalRecruitmentOrganisation'.repeat(3);
    const longLocation = 'VeryLongLocationWithoutOptionalBreaks'.repeat(4);
    const longDescription = 'ContinuousProviderDescriptionWithoutWhitespace'.repeat(20);
    const fixture = createFixture({
      job: {
        ...job,
        title: longTitle,
        company: longCompany,
        location: longLocation,
        description: longDescription,
      },
    });

    const host = fixture.nativeElement as HTMLElement;
    const title = fixture.debugElement.query(By.css('.job-title')).nativeElement as HTMLElement;
    const company = fixture.debugElement.query(By.css('.job-company')).nativeElement as HTMLElement;
    const location = fixture.debugElement.query(By.css('.job-meta > span')).nativeElement as HTMLElement;

    expect(title.textContent).toContain(longTitle);
    expect(title.classList.contains('truncate')).toBe(false);
    expect(company.textContent).toContain(longCompany);
    expect(location.textContent).toContain(longLocation);
    expect(getComputedStyle(host).display).toBe('block');
    expect(getComputedStyle(host).minWidth).toMatch(/^0(?:px)?$/);
    expect(getComputedStyle(title).overflowWrap).toBe('anywhere');
    expect(getComputedStyle(title).whiteSpace).toBe('normal');
    expect(getComputedStyle(company).overflowWrap).toBe('anywhere');
    expect(getComputedStyle(location).overflowWrap).toBe('anywhere');

    expandCard(fixture);
    const description = fixture.debugElement.query(By.css('.job-description')).nativeElement as HTMLElement;
    expect(description.textContent).toContain(longDescription.slice(0, 80));
    expect(getComputedStyle(description).overflowWrap).toBe('anywhere');
  });

  it('loads the complete provider advert when a preview Read full advert action is used', () => {
    const previewJob: Job = {
      ...job,
      externalJobId: 'reed-42',
      primarySource: 'REED',
      descriptionCompleteness: JobDescriptionCompletenessEnum.Preview,
    };
    const fixture = createFixture({job: previewJob});
    const requested: Job[] = [];
    fixture.componentInstance.requestFullDescription.subscribe(value => requested.push(value));
    expandCard(fixture);
    const toggle: HTMLButtonElement = fixture.debugElement
      .query(By.css('.description-toggle')).nativeElement;

    expect(toggle.textContent).toContain('Read full advert');
    toggle.click();
    fixture.detectChanges();

    expect(requested).toEqual([previewJob]);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps an expanded description open while the in-card generation panel becomes active', () => {
    const tail = 'PERSISTENT DESCRIPTION TAIL';
    const description = `${'Relevant job detail '.repeat(30)}${tail}`;
    const fixture = createFixture({ job: { ...job, description } });
    expandCard(fixture);
    fixture.debugElement.query(By.css('.description-toggle')).nativeElement.click();
    fixture.detectChanges();

    fixture.componentRef.setInput('generationPanelActive', true);
    fixture.detectChanges();

    expect(fixture.componentInstance.detailsExpanded()).toBe(true);
    expect(fixture.componentInstance.descriptionExpanded()).toBe(true);
    expect(fixture.debugElement.query(By.css('.job-description')).nativeElement.textContent)
      .toContain(tail);
    expect(fixture.debugElement.query(By.css('[data-testid="generate-documents-button"]'))).toBeNull();
  });

  it('renders provider HTML as text without creating executable elements', () => {
    const unsafeDescription = '<img src=x onerror="window.providerHtmlExecuted=true">';
    const fixture = createFixture({ job: { ...job, description: unsafeDescription } });
    expandCard(fixture);

    expect(fixture.nativeElement.textContent).toContain(unsafeDescription);
    expect(fixture.debugElement.query(By.css('.expanded-content img'))).toBeNull();
  });

  it('keeps provider HTML inert after expanding a long description', () => {
    const unsafeTail = '<script>window.providerHtmlExecuted=true</script>';
    const fixture = createFixture({
      job: {
        ...job,
        description: `${'Safe provider text '.repeat(35)}${unsafeTail}`,
      },
    });
    expandCard(fixture);

    fixture.debugElement.query(By.css('.description-toggle')).nativeElement.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(unsafeTail);
    expect(fixture.debugElement.query(By.css('.expanded-content script'))).toBeNull();
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://user:secret@example.com/job-1',
    'not a URL',
  ])('makes an unsafe provider URL inert: %s', (url) => {
    const fixture = createFixture({ job: { ...job, url } });
    expandCard(fixture);

    expect(fixture.debugElement.query(By.css('a[target="_blank"]'))).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('External job link unavailable.');
  });

  it('falls back from an unsafe direct-apply URL to the approved canonical URL', () => {
    const fixture = createFixture({
      job: {
        ...job,
        sources: [{
          publisher: 'Unsafe publisher',
          directApply: true,
          applyUrl: 'javascript:alert(1)',
        }],
      },
    });
    expandCard(fixture);
    const link: HTMLAnchorElement = fixture.debugElement
      .query(By.css('a[target="_blank"]'))
      .nativeElement;

    expect(link.getAttribute('href')).toBe(job.url);
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('aria-label')).toContain('opens in a new tab');
  });

  it('keeps distinct safe source listings accessible and de-duplicates identical URLs', () => {
    const fixture = createFixture({
      job: {
        ...job,
        sources: [
          {
            publisher: 'Publisher one',
            directApply: true,
            applyUrl: 'https://one.example.test/apply/1',
            listingUrl: 'https://one.example.test/listing/1',
          },
          {
            publisher: 'Publisher duplicate',
            listingUrl: 'https://one.example.test/listing/1',
          },
          {
            publisher: 'Publisher two',
            listingUrl: 'https://two.example.test/listing/1',
          },
        ],
      },
    });
    expandCard(fixture);
    const links: HTMLAnchorElement[] = fixture.debugElement
      .queryAll(By.css('a[target="_blank"]'))
      .map(candidate => candidate.nativeElement);

    expect(links.map(link => link.getAttribute('href'))).toEqual([
      'https://one.example.test/apply/1',
      'https://one.example.test/listing/1',
      'https://two.example.test/listing/1',
      job.url,
    ]);
    expect(links.every(link => link.getAttribute('aria-label')?.includes('opens in a new tab'))).toBe(true);
  });

  it('emits a status update from the document generated actions', () => {
    const fixture = createFixture({ job: { ...job, applicationId: 'app-1', applicationStatus: 'DOCUMENTS_GENERATED' } });
    expandCard(fixture);
    openStatusMenu(fixture);
    const emitted: string[] = [];
    fixture.componentInstance.updateApplicationStatus.subscribe(status => emitted.push(status));

    const button: HTMLButtonElement = fixture.debugElement
      .queryAll(By.css('button'))
      .find(candidate => candidate.nativeElement.textContent.includes('Mark as Applied'))!
      .nativeElement;
    button.click();

    expect(fixture.nativeElement.textContent).not.toContain('Generate CV & Cover Letter');
    expect(fixture.nativeElement.textContent).toContain('Withdraw');
    expect(emitted).toEqual(['APPLIED']);
  });

  it('emits a generated withdrawal action with confirmation', () => {
    const originalConfirm = window.confirm;
    let confirmationMessage = '';
    window.confirm = (message?: string) => {
      confirmationMessage = message ?? '';
      return true;
    };
    const fixture = createFixture({ job: { ...job, applicationId: 'app-1', applicationStatus: 'DOCUMENTS_GENERATED' } });
    const emitted: boolean[] = [];
    const statusUpdates: string[] = [];
    fixture.componentInstance.withdrawGeneratedApplication.subscribe(value => emitted.push(value));
    fixture.componentInstance.updateApplicationStatus.subscribe(status => statusUpdates.push(status));

    fixture.componentInstance.requestStatusUpdate({
      label: 'Withdraw',
      icon: 'block',
      status: 'WITHDRAWN',
      confirmation: 'Withdraw this generated application? This will remove the generated CV and cover letter and reset the job to New.',
      variant: 'secondary',
    });

    expect(confirmationMessage).toEqual('Withdraw this generated application? This will remove the generated CV and cover letter and reset the job to New.');
    expect(emitted).toEqual([true]);
    expect(statusUpdates).toEqual([]);
    window.confirm = originalConfirm;
  });

  it('shows terminal accepted state without status action buttons', () => {
    const fixture = createFixture({ job: { ...job, applicationId: 'app-1', applicationStatus: 'ACCEPTED' } });
    expandCard(fixture);

    expect(fixture.nativeElement.textContent).toContain('Accepted');
    expect(fixture.nativeElement.textContent).not.toContain('Mark as Applied');
    expect(fixture.nativeElement.textContent).not.toContain('Mark Interview');
    expect(fixture.debugElement.query(By.css('.status-dropdown'))).toBeNull();
  });

  it('shows upload buttons while documents are generated', () => {
    const fixture = createFixture({
      downloads,
      job: { ...job, applicationId: 'app-1', applicationStatus: 'DOCUMENTS_GENERATED' },
    });
    expandCard(fixture);

    expect(fixture.nativeElement.textContent).toContain('Upload CV');
    expect(fixture.nativeElement.textContent).toContain('Upload Letter');
  });

  it('hides upload buttons for applied but keeps downloads visible', () => {
    const fixture = createFixture({
      downloads,
      job: { ...job, applicationId: 'app-1', applicationStatus: 'APPLIED' },
    });
    expandCard(fixture);

    expect(fixture.nativeElement.textContent).not.toContain('Upload CV');
    expect(fixture.nativeElement.textContent).not.toContain('Upload Letter');
    expect(fixture.nativeElement.textContent).toContain('Download DOCX');
    expect(fixture.nativeElement.textContent).toContain('Download PDF');
    expect(fixture.nativeElement.textContent).toContain('Documents are locked after applying');
  });

  it('hides upload buttons for interview and unsuccessful statuses', () => {
    for (const status of ['INTERVIEW', 'UNSUCCESSFUL'] as const) {
      const fixture = createFixture({
        downloads,
        job: { ...job, applicationId: 'app-1', applicationStatus: status },
      });
      expandCard(fixture);

      expect(fixture.nativeElement.textContent).not.toContain('Upload CV');
      expect(fixture.nativeElement.textContent).not.toContain('Upload Letter');
      expect(fixture.nativeElement.textContent).toContain('Documents are locked after applying');
    }
  });

  it('shows the correct next actions in the status dropdown', () => {
    const fixture = createFixture({ job: { ...job, applicationId: 'app-1', applicationStatus: 'APPLIED' } });

    expect(fixture.nativeElement.textContent).not.toContain('Mark Interview');
    openStatusMenu(fixture);

    expect(fixture.nativeElement.textContent).toContain('Mark Interview');
    expect(fixture.nativeElement.textContent).toContain('Mark Unsuccessful');
  });

  function createFixture(options: {
    job?: Job;
    generating?: boolean;
    cancellingGeneration?: boolean;
    generationError?: string;
    downloads?: GenerationDownloadsResponse;
    applicationToolsAvailable?: boolean;
    applicationTrackingAvailable?: boolean;
    generationPanelActive?: boolean;
  } = {}) {
    const fixture = TestBed.createComponent(JobCardComponent);
    fixture.componentRef.setInput('job', options.job ?? job);
    fixture.componentRef.setInput('generating', options.generating ?? false);
    fixture.componentRef.setInput('cancellingGeneration', options.cancellingGeneration ?? false);
    fixture.componentRef.setInput('generationError', options.generationError ?? null);
    fixture.componentRef.setInput('downloads', options.downloads ?? null);
    fixture.componentRef.setInput('cvDocumentId', 'cv-123');
    fixture.componentRef.setInput('coverLetterDocumentId', 'cl-456');
    fixture.componentRef.setInput('applicationToolsAvailable', options.applicationToolsAvailable ?? true);
    fixture.componentRef.setInput('applicationTrackingAvailable', options.applicationTrackingAvailable ?? true);
    fixture.componentRef.setInput('generationPanelActive', options.generationPanelActive ?? false);
    fixture.detectChanges();
    return fixture;
  }

  function expandCard(fixture: ReturnType<typeof createFixture>): void {
    fixture.debugElement.query(By.css('button')).nativeElement.click();
    fixture.detectChanges();
  }

  function openStatusMenu(fixture: ReturnType<typeof createFixture>): void {
    fixture.debugElement.query(By.css('.status-dropdown')).nativeElement.click();
    fixture.detectChanges();
  }
});
