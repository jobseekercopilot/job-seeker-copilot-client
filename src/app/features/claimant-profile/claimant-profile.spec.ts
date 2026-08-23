import {TestBed} from '@angular/core/testing';
import axe from 'axe-core';
import {of, Subject, throwError} from 'rxjs';
import type {
  EvidenceEntry,
  EvidenceRevision,
  GatewayResponse,
  ProfessionalContact,
  ProfilePreferencesUpdate,
  UserProfile,
} from '../../api';
import {
  EvidenceEntryCategoryEnum,
  EvidenceLibraryService,
  EvidenceRevisionConfirmationStateEnum,
  ProfileService,
} from '../../api';
import {BrowserSessionService} from '../../services/browser-session.service';
import {idleLocationLookup, LocationService} from '../../services/location.service';
import {ClaimantProfileComponent} from './claimant-profile';

describe('ClaimantProfileComponent progressive profile', () => {
  const updatePreferences = vi.fn();
  const updateProfessionalContact = vi.fn();
  const ensureCsrf = vi.fn(() => of(undefined));
  const invalidateCsrf = vi.fn();
  const handleAuthenticatedError = vi.fn();
  const updateCurrentProfile = vi.fn();
  const lookup = vi.fn(() => of(idleLocationLookup));
  const resolve = vi.fn();
  const listEvidence = vi.fn();

  beforeEach(async () => {
    updatePreferences.mockReset();
    updateProfessionalContact.mockReset();
    ensureCsrf.mockClear();
    invalidateCsrf.mockReset();
    handleAuthenticatedError.mockReset();
    updateCurrentProfile.mockReset();
    lookup.mockReset();
    lookup.mockReturnValue(of(idleLocationLookup));
    resolve.mockReset();
    listEvidence.mockReset();
    listEvidence.mockReturnValue(of(evidenceEntries()));
    updatePreferences.mockImplementation((update: ProfilePreferencesUpdate) => of<GatewayResponse>({
      statusCode: 200,
      success: true,
      user: {
        profile: {
          revision: 4,
          skills: update.skills ?? [],
          qualifications: [],
          roles: [],
          aspirations: update.aspirations,
          workPreferences: update.workPreferences,
        },
      },
    }));
    updateProfessionalContact.mockImplementation((contact: ProfessionalContact) =>
      of<GatewayResponse>({
        statusCode: 200,
        success: true,
        user: {
          profile: {
            revision: 9,
            skills: [],
            qualifications: [],
            roles: [],
            professionalContact: contact,
          },
        },
      }));

    await TestBed.configureTestingModule({
      imports: [ClaimantProfileComponent],
      providers: [
        {
          provide: ProfileService,
          useValue: {updatePreferences, updateProfessionalContact},
        },
        {provide: EvidenceLibraryService, useValue: {listEvidence}},
        {provide: BrowserSessionService, useValue: {
          ensureCsrf,
          invalidateCsrf,
          handleAuthenticatedError,
          updateCurrentProfile,
        }},
        {provide: LocationService, useValue: {lookup, resolve}},
      ],
    }).compileComponents();
  });

  it('updates preferences with revision awareness and no false defaults', async () => {
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.componentRef.setInput('profile', {
      revision: 3,
      skills: [],
      qualifications: [],
      roles: [],
    } satisfies UserProfile);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.startEditing('jobs');
    component.localTargetRoles.set(['Platform Engineer']);

    await component.saveSection();

    expect(updatePreferences).toHaveBeenCalledOnce();
    const [update, ifMatch] = updatePreferences.mock.calls[0];
    expect(ifMatch).toBe('"3"');
    expect(update.aspirations).toEqual({targetRoles: ['Platform Engineer']});
    expect(update.workPreferences).not.toHaveProperty('commuteRange');
    expect(update.workPreferences).not.toHaveProperty('availableFrom');
    expect(update.workPreferences).not.toHaveProperty('noticePeriodDays');
    expect(JSON.parse(JSON.stringify(update)).workPreferences.commuteTravelModes).toEqual([]);
    expect(updateCurrentProfile).toHaveBeenCalledWith(expect.objectContaining({revision: 4}));
    expect(invalidateCsrf).toHaveBeenCalledOnce();
  });

  it('preserves cancel and save behaviour for reusable skills', async () => {
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.componentRef.setInput('profile', {
      revision: 3,
      skills: ['Java'],
      qualifications: [],
      roles: [],
    } satisfies UserProfile);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.startEditing('skills');
    component.localSkills.set(['Java', 'Angular']);
    component.cancelEditing();
    expect(component.localSkills()).toEqual(['Java']);
    expect(component.editingSection()).toBeNull();
    expect(updatePreferences).not.toHaveBeenCalled();

    component.startEditing('skills');
    component.localSkills.set(['Java', 'Angular']);
    await component.saveSection();

    expect(updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({skills: ['Java', 'Angular']}),
      '"3"',
    );
  });

  it('keeps profile areas optional and reports journey-specific readiness', () => {
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.componentRef.setInput('profile', {skills: [], qualifications: [], roles: []});
    fixture.detectChanges();

    expect(fixture.componentInstance.jobSearchPreferencesProgress()).toBe(0);
    expect(fixture.componentInstance.searchReady()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Add a target role or skill');
    expect(fixture.nativeElement.textContent).not.toContain('Documents need confirmed evidence');
    expect(fixture.nativeElement.textContent).not.toContain('Sign out');

    fixture.componentInstance.localTargetRoles.set(['Support analyst']);
    fixture.componentInstance.localWorkplaceArrangements.set(['REMOTE']);
    fixture.detectChanges();
    expect(fixture.componentInstance.searchReady()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Find jobs');
  });

  it('stores a selected location and clears stale derived metadata before lookup', () => {
    vi.useFakeTimers();
    const component = TestBed.createComponent(ClaimantProfileComponent).componentInstance;
    component.selectLocation({
      id: 'place-1',
      name: 'Leeds, West Yorkshire',
      postcode: 'LS1',
      region: 'Yorkshire and the Humber',
      latitude: 53.8,
      longitude: -1.55,
    });
    expect(component.localAdminDistrict()).toBe('Leeds');
    expect(component.localPostcode()).toBe('LS1');

    component.onLocationInputChange('Bradford');
    vi.advanceTimersByTime(300);
    expect(component.localRegion()).toBe('');
    expect(component.localAdminDistrict()).toBe('');
    expect(component.localLatitude()).toBeUndefined();
    expect(lookup).toHaveBeenCalledWith('Bradford');
    vi.useRealTimers();
  });

  it('announces unavailable location lookup feedback as an alert', () => {
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.detectChanges();
    fixture.componentInstance.startEditing('location');
    fixture.componentInstance.locationLookup.set({
      status: 'unavailable',
      locations: [],
      message: 'Location search is temporarily unavailable. Try again.',
    });
    fixture.detectChanges();

    const status = fixture.nativeElement.querySelector(
      '[data-testid="profile-location-status"]',
    ) as HTMLElement;
    expect(status.getAttribute('role')).toBe('alert');
    expect(status.textContent).toContain('temporarily unavailable');
  });

  it('shows an accessible acknowledgement link beside Postcodes.io suggestions', () => {
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.detectChanges();
    fixture.componentInstance.startEditing('location');
    fixture.componentInstance.locationLookup.set({
      status: 'results',
      locations: [],
      message: '1 matching location found.',
      attributionProvider: 'POSTCODES_IO',
    });
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector(
      'a[href="#postcode-data-attribution"]',
    ) as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.textContent).toContain('View data acknowledgements');
  });

  it('preserves underscore-separated canonical field provenance when selecting a location', () => {
    resolve.mockReturnValue(of({
      resolutionStatus: 'RESOLVED',
      location: {
        locationId: 'postcode:ls11aa',
        displayName: 'Leeds, Yorkshire and the Humber',
        countryCode: 'GB',
        postcode: 'LS1 1AA',
        locality: 'Leeds',
        region: 'Yorkshire and the Humber',
        latitude: 53.797,
        longitude: -1.548,
        providerReferences: [
          {provider: 'GOOGLE_PLACES', externalId: 'google-place'},
          {provider: 'POSTCODES_IO', externalId: 'fixture-ls11aa'},
        ],
        fieldProvenance: [
          {field: 'DISPLAY_NAME', source: 'POSTCODES_IO'},
          {field: 'POSTCODE', source: 'POSTCODES_IO'},
          {field: 'COORDINATES', source: 'POSTCODES_IO'},
        ],
      },
    }));
    const component = TestBed.createComponent(ClaimantProfileComponent).componentInstance;

    component.selectLocation({
      id: 'suggestion-1',
      name: 'LS1 1AA',
      postcode: '',
      sessionId: 'session-1',
      suggestionId: 'suggestion-1',
    });

    expect(component.localDisplayNameSource()).toBe('POSTCODES_IO');
    expect(component.localPostcodeSource()).toBe('POSTCODES_IO');
    expect(component.localCoordinatesSource()).toBe('POSTCODES_IO');
    expect(component.localGooglePlaceId()).toBe('google-place');
  });

  it('shows a safe optimistic-concurrency message', async () => {
    updatePreferences.mockReturnValue(throwError(() => ({status: 409, detail: 'private'})));
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.componentRef.setInput('profile', {revision: 2, skills: []});
    fixture.detectChanges();
    fixture.componentInstance.startEditing('jobs');

    await fixture.componentInstance.saveSection();
    fixture.detectChanges();

    expect(fixture.componentInstance.saveError()).toContain('changed in another session');
    expect(fixture.nativeElement.textContent).not.toContain('private');
    expect(handleAuthenticatedError).toHaveBeenCalledWith(expect.objectContaining({status: 409}));
  });

  it('groups job-search preferences separately from reusable career details', async () => {
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const preferences = fixture.nativeElement.querySelector(
      '[data-testid="job-search-preferences"]',
    ) as HTMLElement;
    const careerDetails = fixture.nativeElement.querySelector(
      '[data-testid="profile-evidence-summary"]',
    ) as HTMLElement;

    expect(preferences.textContent).toContain('Job search preferences');
    expect(preferences.textContent).toContain('What I am looking for');
    for (const label of [
      'Target roles',
      'Location and commute',
      'Working preferences',
      'Availability',
    ]) {
      expect(preferences.textContent).toContain(label);
      expect(preferences.querySelector(`[aria-label="Edit ${label}"]`)).not.toBeNull();
    }
    expect(preferences.textContent).not.toContain('Skills & expertise');

    expect(careerDetails.textContent).toContain('Reusable career details');
    expect(careerDetails.textContent).toContain('What I can offer');
    expect(careerDetails.textContent).toContain('Skills & expertise');
    const skillsEdit = careerDetails.querySelector(
      'button[aria-controls="profile-skills-expertise-editor"]',
    ) as HTMLButtonElement;
    expect(skillsEdit).not.toBeNull();
    expect(skillsEdit.getAttribute('aria-label')).toBe('Edit Skills & expertise');
    expect((careerDetails.textContent ?? '').indexOf('Skills & expertise'))
      .toBeLessThan((careerDetails.textContent ?? '').indexOf('Work experience'));

    skillsEdit.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.editingSection()).toBe('skills');
    expect(careerDetails.querySelector('#profile-skills-expertise-editor')).not.toBeNull();
  });

  it('shows the canonical location label with its postcode', () => {
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.componentRef.setInput('profile', {
      skills: [],
      qualifications: [],
      roles: [],
      workPreferences: {
        location: {
          locationId: 'postcode:rg11aa',
          displayName: 'Reading, South East',
          countryCode: 'GB',
          postcode: 'RG1 1AA',
        },
      },
    } satisfies UserProfile);
    fixture.detectChanges();

    const preferences = fixture.nativeElement.querySelector(
      '[data-testid="job-search-preferences"]',
    ) as HTMLElement;
    expect(preferences.textContent).toContain('Reading, South East (RG1 1AA)');
  });

  it('shows exact user-declared professional contact without inferring missing details', () => {
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.componentRef.setInput('profile', {
      revision: 8,
      skills: [],
      qualifications: [],
      roles: [],
      professionalContact: {
        phone: '+44 (0)20 7946 0958',
        links: [
          {label: 'GitHub', url: 'https://github.com/synthetic-candidate'},
          {label: 'Portfolio', url: 'https://portfolio.example.test/work'},
        ],
      },
    } satisfies UserProfile);
    fixture.detectChanges();

    const contact = fixture.nativeElement.querySelector(
      '[data-testid="profile-professional-contact"]',
    ) as HTMLElement;
    expect(contact.textContent).toContain('Contact shown on CVs and cover letters');
    expect(contact.textContent).toContain('+44 (0)20 7946 0958');
    expect(contact.textContent).toContain('https://github.com/synthetic-candidate');
    expect(contact.textContent).toContain('https://portfolio.example.test/work');
    expect(contact.textContent).not.toContain('LinkedIn');
    expect(contact.querySelectorAll('a')).toHaveLength(2);
  });

  it('saves bounded professional contact through the revision-aware owner route', async () => {
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.componentRef.setInput('profile', {
      revision: 8,
      skills: [],
      qualifications: [],
      roles: [],
      professionalContact: {
        phone: '+44 20 7946 0001',
        links: [{label: 'GitHub', url: 'https://github.com/initial-synthetic'}],
      },
    } satisfies UserProfile);
    fixture.detectChanges();
    const saved = vi.fn();
    fixture.componentInstance.profileSaved.subscribe(saved);
    fixture.componentInstance.startEditing('contact');
    fixture.componentInstance.localProfessionalPhone.set('+44 20 7946 0999');
    fixture.componentInstance.localProfessionalLinks.set([
      {label: 'GitHub', url: 'https://github.com/synthetic-candidate'},
      {label: 'Demo', url: 'https://demo.example.test/application-pack'},
    ]);

    await fixture.componentInstance.saveSection();

    const expectedContact = {
      phone: '+44 20 7946 0999',
      links: [
        {label: 'GitHub', url: 'https://github.com/synthetic-candidate'},
        {label: 'Demo', url: 'https://demo.example.test/application-pack'},
      ],
    };
    expect(ensureCsrf).toHaveBeenCalledOnce();
    expect(updateProfessionalContact).toHaveBeenCalledWith(
      expectedContact,
      '"8"',
      'body',
      false,
      {transferCache: false},
    );
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(updateCurrentProfile).toHaveBeenCalledWith(expect.objectContaining({
      revision: 9,
      professionalContact: expectedContact,
    }));
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({
      profile: expect.objectContaining({professionalContact: expectedContact}),
    }));
    expect(fixture.componentInstance.editingSection()).toBeNull();
    expect(invalidateCsrf).toHaveBeenCalledOnce();
  });

  it('rejects unsafe links before CSRF bootstrap or profile mutation', async () => {
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.componentRef.setInput('profile', {
      revision: 2,
      skills: [],
      qualifications: [],
      roles: [],
    } satisfies UserProfile);
    fixture.detectChanges();
    fixture.componentInstance.startEditing('contact');
    fixture.componentInstance.localProfessionalLinks.set([
      {label: 'Portfolio', url: 'http://portfolio.example.test'},
    ]);

    await fixture.componentInstance.saveSection();
    fixture.detectChanges();

    expect(fixture.componentInstance.saveError()).toContain('valid HTTPS address');
    expect(ensureCsrf).not.toHaveBeenCalled();
    expect(updateProfessionalContact).not.toHaveBeenCalled();
    expect(updatePreferences).not.toHaveBeenCalled();
  });

  it('provides labelled contact controls and enforces the eight-link UI limit', () => {
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.detectChanges();
    fixture.componentInstance.startEditing('contact');
    fixture.componentInstance.localProfessionalLinks.set(Array.from({length: 8}, (_, index) => ({
      label: `Example ${index + 1}`,
      url: `https://example${index + 1}.test/profile`,
    })));
    fixture.componentInstance.addProfessionalLink();
    fixture.detectChanges();

    const contact = fixture.nativeElement.querySelector(
      '[data-testid="profile-professional-contact"]',
    ) as HTMLElement;
    expect(fixture.componentInstance.localProfessionalLinks()).toHaveLength(8);
    expect(contact.querySelector('label[for="profile-professional-phone"]')).not.toBeNull();
    expect(contact.querySelector('label[for="profile-professional-link-label-0"]')?.textContent)
      .toContain('Link 1 label');
    expect(contact.querySelector('label[for="profile-professional-link-url-0"]')?.textContent)
      .toContain('Link 1 HTTPS address');
    const add = Array.from(contact.querySelectorAll('button')).find(button =>
      button.textContent?.includes('Add professional link')) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(contact.querySelectorAll('.contact-link-remove')).toHaveLength(8);
  });

  it('shows a compact three-row active evidence summary and opens the manager', async () => {
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    const openManager = vi.fn();
    fixture.componentInstance.manageEvidenceRequested.subscribe(openManager);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const summary = fixture.nativeElement.querySelector(
      '[data-testid="profile-evidence-summary"]',
    ) as HTMLElement;
    expect(summary.querySelectorAll('.evidence-summary-row')).toHaveLength(3);
    expect(summary.textContent).toContain('Work experience');
    expect(summary.textContent).toContain('1 confirmed · 1 needs review');
    expect(summary.textContent).toContain('Qualifications');
    expect(summary.textContent).toContain('1 confirmed');
    expect(summary.textContent).toContain('Projects and achievements');
    expect(summary.textContent).toContain('No entries yet');

    (summary.querySelector('#manage-experience-evidence') as HTMLButtonElement).click();
    expect(openManager).toHaveBeenCalledOnce();
  });

  it('does not let a stale evidence response overwrite the current summary', async () => {
    const older = new Subject<EvidenceEntry[]>();
    const newer = new Subject<EvidenceEntry[]>();
    listEvidence.mockReturnValueOnce(older).mockReturnValueOnce(newer);
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.detectChanges();

    const refresh = fixture.componentInstance.refreshEvidenceSummary();
    newer.next([evidenceEntries()[2]]);
    newer.complete();
    await refresh;
    older.next(evidenceEntries());
    older.complete();
    await fixture.whenStable();

    expect(fixture.componentInstance.evidenceEntries()).toHaveLength(1);
    expect(fixture.componentInstance.evidenceSummary(
      fixture.componentInstance.evidenceSummaryRows[1],
    )).toBe('1 confirmed');
  });

  it('has no detectable axe violations in read and section-edit modes', async () => {
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.detectChanges();
    await expectNoAxeViolations(fixture.nativeElement);
    fixture.componentInstance.startEditing('patterns');
    fixture.detectChanges();
    await expectNoAxeViolations(fixture.nativeElement);
    fixture.componentInstance.startEditing('skills');
    fixture.detectChanges();
    await expectNoAxeViolations(fixture.nativeElement);
    fixture.componentInstance.startEditing('contact');
    fixture.componentInstance.addProfessionalLink();
    fixture.detectChanges();
    await expectNoAxeViolations(fixture.nativeElement);
  });
});

async function expectNoAxeViolations(element: HTMLElement): Promise<void> {
  const result = await axe.run(element, {
    rules: {'color-contrast': {enabled: false}},
  });
  expect(result.violations.map(violation => ({
    id: violation.id,
    targets: violation.nodes.map(node => node.target),
  }))).toEqual([]);
}

function evidenceEntries(): EvidenceEntry[] {
  return [
    evidenceEntry(
      EvidenceEntryCategoryEnum.Employment,
      EvidenceRevisionConfirmationStateEnum.UserConfirmed,
      false,
      'employment-confirmed',
    ),
    evidenceEntry(
      EvidenceEntryCategoryEnum.Freelance,
      EvidenceRevisionConfirmationStateEnum.UserConfirmed,
      true,
      'freelance-review',
    ),
    evidenceEntry(
      EvidenceEntryCategoryEnum.QualificationTraining,
      EvidenceRevisionConfirmationStateEnum.UserConfirmed,
      false,
      'qualification',
    ),
    {
      ...evidenceEntry(
        EvidenceEntryCategoryEnum.Project,
        EvidenceRevisionConfirmationStateEnum.UserConfirmed,
        false,
        'archived-project',
      ),
      lifecycle: 'ARCHIVED',
    } as EvidenceEntry,
  ];
}

function evidenceEntry(
  category: EvidenceEntry['category'],
  confirmationState: EvidenceRevision['confirmationState'],
  reviewRequired: boolean,
  id: string,
): EvidenceEntry {
  return {
    entryId: id,
    category,
    lifecycle: 'ACTIVE',
    visibility: 'VISIBLE',
    reviewRequired,
    version: 1,
    revisions: [{
      revisionId: `${id}-revision`,
      revisionNumber: 1,
      confirmationState,
      contentDigest: 'digest',
      heading: id,
      ongoing: false,
      demonstratedSkills: [],
      supportingLinks: [],
      facts: [],
      createdAt: '2026-07-29T00:00:00Z',
      createdBy: 'USER',
    } as EvidenceRevision],
  } as EvidenceEntry;
}
