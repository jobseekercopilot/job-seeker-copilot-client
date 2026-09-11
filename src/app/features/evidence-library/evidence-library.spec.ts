import {TestBed} from '@angular/core/testing';
import axe from 'axe-core';
import fc from 'fast-check';
import {of, Subject, throwError} from 'rxjs';
import type {EvidenceEntry, EvidenceRevision} from '../../api';
import {EvidenceLibraryService} from '../../api';
import {BrowserSessionService} from '../../services/browser-session.service';
import {EvidenceLibraryComponent} from './evidence-library';

describe('EvidenceLibraryComponent', () => {
  const listEvidence = vi.fn();
  const createEvidence = vi.fn();
  const updateEvidence = vi.fn();
  const confirmEvidence = vi.fn();
  const archiveEvidence = vi.fn();
  const restoreEvidence = vi.fn();
  const hideEvidence = vi.fn();
  const showEvidence = vi.fn();
  const supersedeEvidence = vi.fn();
  const ensureCsrf = vi.fn(() => of(undefined));
  const invalidateCsrf = vi.fn();
  const handleAuthenticatedError = vi.fn();

  beforeEach(async () => {
    for (const mock of [
      listEvidence, createEvidence, updateEvidence, confirmEvidence,
      archiveEvidence, restoreEvidence, hideEvidence, showEvidence,
      supersedeEvidence,
      invalidateCsrf, handleAuthenticatedError,
    ]) mock.mockReset();
    ensureCsrf.mockClear();
    listEvidence.mockReturnValue(of([entry()]));
    createEvidence.mockReturnValue(of(entry()));
    updateEvidence.mockReturnValue(of(entry()));
    confirmEvidence.mockReturnValue(of(entry({confirmed: true})));
    archiveEvidence.mockReturnValue(of(entry({lifecycle: 'ARCHIVED'})));
    restoreEvidence.mockReturnValue(of(entry()));
    hideEvidence.mockReturnValue(of(entry()));
    showEvidence.mockReturnValue(of(entry()));
    supersedeEvidence.mockReturnValue(of(entry({lifecycle: 'SUPERSEDED'})));

    await TestBed.configureTestingModule({
      imports: [EvidenceLibraryComponent],
      providers: [
        {provide: EvidenceLibraryService, useValue: {
          listEvidence,
          createEvidence,
          updateEvidence,
          confirmEvidence,
          archiveEvidence,
          restoreEvidence,
          hideEvidence,
          showEvidence,
          supersedeEvidence,
        }},
        {provide: BrowserSessionService, useValue: {
          ensureCsrf,
          invalidateCsrf,
          handleAuthenticatedError,
        }},
      ],
    }).compileComponents();
  });

  it('shows migrated drafts as review-required without implying verification', async () => {
    const fixture = TestBed.createComponent(EvidenceLibraryComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('We moved your existing work history');
    expect(fixture.nativeElement.textContent).toContain('Migrated item');
    expect(fixture.nativeElement.textContent).toContain('not independently verified');
    expect(listEvidence).toHaveBeenCalledWith(false, 'body', false, {transferCache: false});

    (fixture.nativeElement.querySelector('.card-action') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Revision history');
    expect(fixture.nativeElement.textContent).toContain('Revision 1');
  });

  it('creates a category-aware draft through the generated client', async () => {
    const component = TestBed.createComponent(EvidenceLibraryComponent).componentInstance;
    component.openCreate();
    component.category.set('PROJECT');
    component.heading.set('Public service redesign');
    component.projectRole.set('Delivery lead');
    component.organisationContext.set('Independent project');
    component.description.set('Redesigned a bounded public service workflow.');
    component.demonstratedSkills.set('Discovery, Delivery');
    component.supportingLinks.set('https://example.test/project');

    await component.saveDraft();

    expect(createEvidence).toHaveBeenCalledWith(expect.objectContaining({
      category: 'PROJECT',
      heading: 'Public service redesign',
      projectRole: 'Delivery lead',
      organisationContext: 'Independent project',
      demonstratedSkills: ['Discovery', 'Delivery'],
      supportingLinks: ['https://example.test/project'],
    }), 'body', false, {transferCache: false});
    expect(invalidateCsrf).toHaveBeenCalledOnce();
  });

  it('edits as a new draft, confirms, and requires a second archive action', async () => {
    const component = TestBed.createComponent(EvidenceLibraryComponent).componentInstance;
    const current = entry();
    component.openEdit(current);
    component.achievements.set('Improved completion by 10%.');
    await component.saveDraft();
    expect(updateEvidence).toHaveBeenCalledWith(
      current.entryId, expect.objectContaining({achievements: 'Improved completion by 10%.'}),
      '"2"', 'body', false, {transferCache: false});

    await component.perform(current, 'confirm');
    expect(confirmEvidence).toHaveBeenCalledWith(current.entryId, '"2"');

    await component.perform(current, 'archive');
    expect(archiveEvidence).not.toHaveBeenCalled();
    expect(component.pendingArchive()).toBe(current);
    await component.confirmArchive();
    expect(archiveEvidence).toHaveBeenCalledWith(current.entryId, '"2"');
  });

  it('reloads archived evidence explicitly and reports optimistic conflicts safely', async () => {
    const component = TestBed.createComponent(EvidenceLibraryComponent).componentInstance;
    component.toggleArchived();
    expect(listEvidence).toHaveBeenCalledWith(true, 'body', false, {transferCache: false});

    updateEvidence.mockReturnValue(throwError(() => ({status: 409, body: 'private'})));
    component.openEdit(entry());
    await component.saveDraft();
    expect(component.error()).toContain('changed in another session');
    expect(component.error()).not.toContain('private');
  });

  it('shows evidence details and confirms superseding against a selected replacement', async () => {
    const component = TestBed.createComponent(EvidenceLibraryComponent).componentInstance;
    const older = entry();
    const replacement = {
      ...entry(),
      entryId: '33333333-3333-3333-3333-333333333333',
      reviewRequired: false,
    };
    component.entries.set([older, replacement]);

    component.toggleView(older);
    expect(component.viewingEntryId()).toBe(older.entryId);
    component.openSupersede(older);
    component.replacementEntryId.set(replacement.entryId);
    await component.confirmSupersede();

    expect(supersedeEvidence).toHaveBeenCalledWith(
      older.entryId,
      {replacementEntryId: replacement.entryId},
      '"2"',
    );
  });

  it('removes an employment end date when Current is selected and omits it from the payload', async () => {
    const fixture = TestBed.createComponent(EvidenceLibraryComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.openCreate();
    component.roleTitle.set('Software developer');
    component.organisationContext.set('Example Ltd');
    component.startDate.set('2024-02-01');
    component.endDate.set('2026-07-01');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('input[name="endDate"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('input[name="heading"]')).toBeNull();

    component.setOngoing(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name="endDate"]')).toBeNull();
    expect(component.endDate()).toBe('');
    expect(fixture.nativeElement.textContent).toContain('end date was removed');

    await component.saveDraft();
    const request = createEvidence.mock.calls.at(-1)?.[0];
    expect(request).toEqual(expect.objectContaining({
      category: 'EMPLOYMENT',
      heading: 'Software developer',
      ongoing: true,
    }));
    expect(request).not.toHaveProperty('endDate');
  });

  it('saves exactly the status-specific education date without an ongoing flag', async () => {
    const component = TestBed.createComponent(EvidenceLibraryComponent).componentInstance;
    component.openCreate();
    component.changeCategory('EDUCATION');
    component.programmeOrSubject.set('BSc Computing');
    component.institution.set('Example University');
    component.issueDate.set('2025-06-01');

    await component.saveDraft();
    let request = createEvidence.mock.calls.at(-1)?.[0];
    expect(request).toEqual(expect.objectContaining({
      heading: 'BSc Computing',
      resultOrStatus: 'Completed',
      issueDate: {precision: 'DAY', year: 2025, month: 6, day: 1},
    }));
    expect(request).not.toHaveProperty('endDate');
    expect(request).not.toHaveProperty('ongoing');

    component.openCreate();
    component.changeCategory('EDUCATION');
    component.programmeOrSubject.set('MSc Computing');
    component.institution.set('Example University');
    component.setCompletionStatus('In progress');
    component.endDate.set('2027-09-01');
    await component.saveDraft();

    request = createEvidence.mock.calls.at(-1)?.[0];
    expect(request).toEqual(expect.objectContaining({
      resultOrStatus: 'In progress',
      endDate: {precision: 'DAY', year: 2027, month: 9, day: 1},
    }));
    expect(request).not.toHaveProperty('issueDate');
    expect(request).not.toHaveProperty('ongoing');
  });

  it('preserves partial-date precision and a private qualification identifier while details are collapsed', async () => {
    const current = entry();
    const revision = current.revisions[0];
    const qualification = {
      ...current,
      category: 'QUALIFICATION_TRAINING',
      revisions: [{
        ...revision,
        heading: 'AWS Cloud Practitioner',
        roleTitle: undefined,
        organisationContext: undefined,
        qualificationTitle: 'AWS Cloud Practitioner',
        issuer: 'AWS',
        resultOrStatus: 'Completed',
        issueDate: {precision: 'YEAR', year: 2025},
        startDate: undefined,
        endDate: undefined,
        privateCredentialIdentifier: 'private-credential-123',
      }],
    } as EvidenceEntry;
    const component = TestBed.createComponent(EvidenceLibraryComponent).componentInstance;

    component.openEdit(qualification);
    expect(component.advancedExpanded()).toBe(false);
    await component.saveDraft();

    expect(updateEvidence).toHaveBeenCalledWith(
      qualification.entryId,
      expect.objectContaining({
        heading: 'AWS Cloud Practitioner',
        issueDate: {precision: 'YEAR', year: 2025},
        privateCredentialIdentifier: 'private-credential-123',
      }),
      '"2"',
      'body',
      false,
      {transferCache: false},
    );
  });

  it('accepts freelance evidence without a client and never offers or sends a career-break reason', async () => {
    const fixture = TestBed.createComponent(EvidenceLibraryComponent);
    const component = fixture.componentInstance;
    component.openCreate();
    component.changeCategory('FREELANCE');
    component.roleTitle.set('Accessibility review');
    component.description.set('Reviewed a public website against WCAG.');
    component.qualificationTitle.set('Unrelated hidden value');
    await component.saveDraft();

    const freelanceRequest = createEvidence.mock.calls.at(-1)?.[0];
    expect(freelanceRequest).toEqual(expect.objectContaining({
      category: 'FREELANCE',
      heading: 'Accessibility review',
    }));
    expect(freelanceRequest.organisationContext).toBeUndefined();
    expect(freelanceRequest).not.toHaveProperty('qualificationTitle');

    component.openCreate();
    component.changeCategory('CAREER_BREAK');
    component.heading.set('Career break');
    component.description.set('Optional neutral context.');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Reason');
    await component.saveDraft();
    expect(createEvidence.mock.calls.at(-1)?.[0]).not.toHaveProperty('careerBreakReason');
  });

  it('ignores a late evidence-list response and emits changes after successful mutations', async () => {
    const older = new Subject<EvidenceEntry[]>();
    const newer = new Subject<EvidenceEntry[]>();
    listEvidence.mockReturnValueOnce(older).mockReturnValueOnce(newer);
    const component = TestBed.createComponent(EvidenceLibraryComponent).componentInstance;
    const changed = vi.fn();
    component.changed.subscribe(changed);

    const firstLoad = component.load();
    const secondLoad = component.load();
    const replacement = {...entry(), entryId: '44444444-4444-4444-4444-444444444444'};
    newer.next([replacement]);
    newer.complete();
    await secondLoad;
    older.next([entry()]);
    older.complete();
    await firstLoad;

    expect(component.entries().map(candidate => candidate.entryId)).toEqual([
      replacement.entryId,
    ]);
    await component.perform(replacement, 'confirm');
    expect(changed).toHaveBeenCalledOnce();
  });

  it('has no detectable axe violations', async () => {
    const fixture = TestBed.createComponent(EvidenceLibraryComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const result = await axe.run(fixture.nativeElement, {
      rules: {'color-contrast': {enabled: false}},
    });
    expect(result.violations.map(violation => violation.id)).toEqual([]);
  });

  // Task 3.1 — template conditional rendering (Requirements 6.2, 6.3)
  // These tests are written ahead of the template changes (task 3) and are
  // expected to fail until the @if (!onboardingCategory()) guards and the
  // openCreate() ngOnInit branch are added to evidence-library.html.
  describe('onboarding mode template', () => {
    it('hides the category selector when onboardingCategory is set', async () => {
      const fixture = TestBed.createComponent(EvidenceLibraryComponent);
      fixture.componentRef.setInput('onboardingCategory', 'QUALIFICATION_TRAINING');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      // The category selector (both the filter-bar category select and the
      // in-form category select) must not be present in onboarding mode.
      // The filter bar lives in `.flex.flex-wrap.gap-3.items-end`; the in-form
      // category select is `select[name="category"]`.
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.flex.flex-wrap.gap-3.items-end select')).toBeNull();
      expect(el.querySelector('select[name="category"]')).toBeNull();
    });

    it('hides the entry list and filter controls when onboardingCategory is set', async () => {
      const fixture = TestBed.createComponent(EvidenceLibraryComponent);
      fixture.componentRef.setInput('onboardingCategory', 'EMPLOYMENT');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;

      // Filter controls (Category / Readiness selects and "Show archived" checkbox) must be absent.
      // The filter bar is the `.flex.flex-wrap.gap-3.items-end` block; it must not render at all.
      expect(el.querySelector('.flex.flex-wrap.gap-3.items-end')).toBeNull();
      // "Category" and "Readiness" filter label text should not be present.
      const labelTexts = Array.from(el.querySelectorAll('label')).map(l => l.textContent ?? '');
      expect(labelTexts.some(t => /^Category\s*$/.test(t.trim()))).toBe(false);
      expect(labelTexts.some(t => /^Readiness\s*$/.test(t.trim()))).toBe(false);
      // The "Show archived" toggle must be absent.
      expect(el.textContent).not.toContain('Show archived');

      // The entry-list area (evidence-card elements) should not be rendered
      expect(el.querySelector('[data-testid="evidence-card"]')).toBeNull();

      // The state legend (Draft / User confirmed / Archived grid) should not be rendered
      expect(el.querySelector('dl')).toBeNull();
    });

    it('renders the create form open by default in onboarding mode', async () => {
      const fixture = TestBed.createComponent(EvidenceLibraryComponent);
      fixture.componentRef.setInput('onboardingCategory', 'VOLUNTEERING');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;

      // The editor form should be present without the user having clicked "Add"
      const form = el.querySelector('form');
      expect(form).not.toBeNull();

      // editorMode signal should be 'create'
      expect(fixture.componentInstance.editorMode()).toBe('create');
    });

    it('shows the full UI — filter controls, entry list, and no open form — when onboardingCategory is null', async () => {
      // Baseline: verify standard mode is unaffected (Requirement 6.5 / 9.4)
      const fixture = TestBed.createComponent(EvidenceLibraryComponent);
      // default is null, so no setInput call
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;

      // Filter controls must be present
      const selects = el.querySelectorAll('select');
      expect(selects.length).toBeGreaterThanOrEqual(2);

      // Entry list area must be rendered (the component renders the loading/empty state)
      // At minimum the "Add experience or achievement" button must be visible
      expect(el.textContent).toContain('Add experience or achievement');

      // The editor form should NOT be open by default in standard mode
      expect(fixture.componentInstance.editorMode()).toBeNull();
    });
  });

  // Task 2.2 — unit tests for onboarding mode save behaviour
  // (Requirements 6.6, 6.7, 6.8, 8.1, 8.2)
  describe('onboarding mode save behaviour', () => {
    it('emits entryAdded after a successful saveDraft when onboardingCategory is set', async () => {
      const fixture = TestBed.createComponent(EvidenceLibraryComponent);
      fixture.componentRef.setInput('onboardingCategory', 'QUALIFICATION_TRAINING');
      fixture.detectChanges();
      await fixture.whenStable();
      const component = fixture.componentInstance;
      const added = vi.fn();
      component.entryAdded.subscribe(added);

      fillValidOnboardingForm(component, 'QUALIFICATION_TRAINING');
      await component.saveDraft();

      expect(createEvidence).toHaveBeenCalledOnce();
      expect(added).toHaveBeenCalledOnce();
      expect(component.error()).toBeNull();
    });

    it('does NOT emit entryAdded when createEvidence returns an error', async () => {
      createEvidence.mockReturnValueOnce(throwError(() => ({status: 500, body: 'boom'})));
      const fixture = TestBed.createComponent(EvidenceLibraryComponent);
      fixture.componentRef.setInput('onboardingCategory', 'EMPLOYMENT');
      fixture.detectChanges();
      await fixture.whenStable();
      const component = fixture.componentInstance;
      const added = vi.fn();
      component.entryAdded.subscribe(added);

      fillValidOnboardingForm(component, 'EMPLOYMENT');
      await component.saveDraft();

      expect(createEvidence).toHaveBeenCalledOnce();
      expect(added).not.toHaveBeenCalled();
      expect(component.error()).not.toBeNull();
    });

    it('resets the form and keeps the editor open after a successful onboarding save', async () => {
      const fixture = TestBed.createComponent(EvidenceLibraryComponent);
      fixture.componentRef.setInput('onboardingCategory', 'VOLUNTEERING');
      fixture.detectChanges();
      await fixture.whenStable();
      const component = fixture.componentInstance;

      fillValidOnboardingForm(component, 'VOLUNTEERING');
      await component.saveDraft();

      // Editor stays open in create mode for another entry
      expect(component.editorMode()).toBe('create');
      // Form fields reset to empty; category remains fixed to the onboarding category
      expect(component.roleTitle()).toBe('');
      expect(component.organisationContext()).toBe('');
      expect(component.description()).toBe('');
      expect(component.category()).toBe('VOLUNTEERING');
    });

    it('does not call listEvidence on ngOnInit when onboardingCategory is set', async () => {
      const fixture = TestBed.createComponent(EvidenceLibraryComponent);
      fixture.componentRef.setInput('onboardingCategory', 'QUALIFICATION_TRAINING');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(listEvidence).not.toHaveBeenCalled();
    });
  });

  // Task 2.3 — Property 6: Onboarding mode save cycle correctness
  // Validates: Requirements 6.4, 6.6, 6.7, 6.8
  describe('Property 6 — onboarding mode save cycle', () => {
    it('invokes createEvidence with the onboardingCategory, emits entryAdded once per save, and resets while keeping the editor open', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('QUALIFICATION_TRAINING', 'EMPLOYMENT', 'VOLUNTEERING'),
          fc.integer({min: 1, max: 5}),
          async (onboardingCategory, saveCount) => {
            createEvidence.mockClear();
            const fixture = TestBed.createComponent(EvidenceLibraryComponent);
            fixture.componentRef.setInput('onboardingCategory', onboardingCategory);
            fixture.detectChanges();
            await fixture.whenStable();
            const component = fixture.componentInstance;
            const added = vi.fn();
            component.entryAdded.subscribe(added);

            for (let i = 0; i < saveCount; i++) {
              fillValidOnboardingForm(component, onboardingCategory);
              await component.saveDraft();
            }

            // createEvidence called once per save, always with the fixed category
            expect(createEvidence).toHaveBeenCalledTimes(saveCount);
            for (const call of createEvidence.mock.calls) {
              expect(call[0].category).toBe(onboardingCategory);
            }
            // entryAdded emitted exactly once per successful save
            expect(added).toHaveBeenCalledTimes(saveCount);
            // Editor remains open in create mode and the form is reset
            expect(component.editorMode()).toBe('create');
            expect(component.category()).toBe(onboardingCategory);
            expect(component.heading()).toBe('');
            expect(component.roleTitle()).toBe('');
            expect(component.qualificationTitle()).toBe('');
            expect(component.description()).toBe('');
          },
        ),
        {numRuns: 25},
      );
    });
  });

  // Task 2.4 — Property 8: Save failure produces error display without emitting entryAdded
  // Validates: Requirements 8.1, 8.2
  describe('Property 8 — save failure behaviour', () => {
    it('sets an inline error and never emits entryAdded for any API error shape', async () => {
      const errorArbitrary = fc.oneof(
        // HttpErrorResponse-like shapes with varying status codes and bodies
        fc.record({
          status: fc.constantFrom(400, 401, 403, 404, 409, 422, 500, 502, 503),
          body: fc.oneof(fc.string(), fc.constant(undefined), fc.constant(null)),
        }),
        // A plain Error
        fc.string().map(message => new Error(message)),
        // An arbitrary object without a status
        fc.record({message: fc.string()}),
      );

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('QUALIFICATION_TRAINING', 'EMPLOYMENT', 'VOLUNTEERING'),
          errorArbitrary,
          async (onboardingCategory, apiError) => {
            createEvidence.mockClear();
            createEvidence.mockReturnValueOnce(throwError(() => apiError));
            const fixture = TestBed.createComponent(EvidenceLibraryComponent);
            fixture.componentRef.setInput('onboardingCategory', onboardingCategory);
            fixture.detectChanges();
            await fixture.whenStable();
            const component = fixture.componentInstance;
            const added = vi.fn();
            component.entryAdded.subscribe(added);

            fillValidOnboardingForm(component, onboardingCategory);
            await component.saveDraft();

            // An inline error message is displayed
            expect(component.error()).not.toBeNull();
            expect(typeof component.error()).toBe('string');
            // entryAdded is never emitted on failure
            expect(added).not.toHaveBeenCalled();
          },
        ),
        {numRuns: 30},
      );
    });
  });

  // Task 3.2 — Property 5: Onboarding mode hides non-form UI elements
  // Validates: Requirements 6.2, 6.3
  describe('Property 5 — onboarding mode UI hiding', () => {
    it('never renders the category selector, entry list, or filter controls for any onboarding category', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('QUALIFICATION_TRAINING', 'EMPLOYMENT', 'VOLUNTEERING'),
          async (onboardingCategory) => {
            const fixture = TestBed.createComponent(EvidenceLibraryComponent);
            fixture.componentRef.setInput('onboardingCategory', onboardingCategory);
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();

            const el: HTMLElement = fixture.nativeElement;

            // Category selector (filter-bar select and in-form category select) absent
            expect(el.querySelector('.flex.flex-wrap.gap-3.items-end select')).toBeNull();
            expect(el.querySelector('select[name="category"]')).toBeNull();
            // Filter controls block absent
            expect(el.querySelector('.flex.flex-wrap.gap-3.items-end')).toBeNull();
            expect(el.textContent).not.toContain('Show archived');
            // Entry list absent
            expect(el.querySelector('[data-testid="evidence-card"]')).toBeNull();
          },
        ),
        {numRuns: 15},
      );
    });
  });
});

// Fills the create-form signals with the minimum valid values so that
// validationError() returns null for the given onboarding category.
function fillValidOnboardingForm(
  component: EvidenceLibraryComponent,
  category: string,
): void {
  switch (category) {
    case 'QUALIFICATION_TRAINING':
      component.qualificationTitle.set('First aid certificate');
      component.issuer.set('St John Ambulance');
      component.setCompletionStatus('Completed');
      component.issueDate.set('2025-06-01');
      break;
    case 'EMPLOYMENT':
      component.roleTitle.set('Software developer');
      component.organisationContext.set('Example Ltd');
      component.startDate.set('2024-02-01');
      component.setOngoing(true);
      break;
    case 'VOLUNTEERING':
      component.roleTitle.set('Community mentor');
      component.organisationContext.set('Local charity');
      component.description.set('Mentored young people seeking work.');
      break;
    default:
      throw new Error(`Unsupported onboarding category: ${category}`);
  }
}

function entry(options: {
  confirmed?: boolean;
  lifecycle?: 'ACTIVE' | 'ARCHIVED' | 'SUPERSEDED';
} = {}): EvidenceEntry {
  const revision = {
    revisionId: '22222222-2222-2222-2222-222222222222',
    revisionNumber: 1,
    confirmationState: options.confirmed ? 'USER_CONFIRMED' : 'DRAFT',
    contentDigest: 'digest',
    heading: 'Migrated adviser role',
    organisationContext: 'Example council',
    roleTitle: 'Adviser',
    ongoing: false,
    startDate: {precision: 'MONTH', year: 2022, month: 3},
    endDate: {precision: 'YEAR', year: 2025},
    demonstratedSkills: ['Customer service'],
    supportingLinks: [],
    facts: [],
    createdAt: '2026-07-29T00:00:00Z',
    createdBy: 'LEGACY_MIGRATION',
  } as EvidenceRevision;
  return {
    entryId: '11111111-1111-1111-1111-111111111111',
    category: 'EMPLOYMENT',
    visibility: 'VISIBLE',
    lifecycle: options.lifecycle ?? 'ACTIVE',
    reviewRequired: !options.confirmed,
    version: 2,
    revisions: [revision],
  } as EvidenceEntry;
}
