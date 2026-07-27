import {TestBed} from '@angular/core/testing';
import {of, throwError} from 'rxjs';
import {JobService} from '../../services/job.service';
import {BetaJobSearchComponent} from './beta-job-search';

describe('BetaJobSearchComponent', () => {
  const searchJobs = vi.fn();

  beforeEach(async () => {
    searchJobs.mockReset();
    searchJobs.mockReturnValue(of({
      jobs: [{
        canonicalJobId: 'fixture-1',
        title: 'Software Developer',
        companyName: 'Fixture Employer',
        canonicalLocation: {displayName: 'Reading'},
        description: 'Build useful software.',
      }],
      totalResults: 1,
    }));
    await TestBed.configureTestingModule({
      imports: [BetaJobSearchComponent],
      providers: [{provide: JobService, useValue: {searchJobs}}],
    }).compileComponents();
  });

  it('searches from profile-derived values and renders canonical results', () => {
    const fixture = TestBed.createComponent(BetaJobSearchComponent);
    fixture.componentRef.setInput('skills', 'TypeScript');
    fixture.componentRef.setInput('aspirations', 'Software Developer');
    fixture.componentRef.setInput('workPrefs', '{"postcode":"RG1 1AA"}');
    fixture.detectChanges();

    expect(searchJobs).toHaveBeenCalledWith(
      'TypeScript',
      '',
      'Software Developer',
      '{"postcode":"RG1 1AA"}',
    );
    expect(fixture.nativeElement.textContent).toContain('Software Developer');
    expect(fixture.nativeElement.textContent).toContain('Fixture Employer · Reading');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="job-result-card"]')).toHaveLength(1);
  });

  it('renders an actionable error without exposing downstream details', () => {
    searchJobs.mockReturnValue(throwError(() => ({status: 503, error: 'internal detail'})));
    const fixture = TestBed.createComponent(BetaJobSearchComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent)
      .toContain('Job matches are temporarily unavailable');
    expect(fixture.nativeElement.textContent).not.toContain('internal detail');
  });
});
