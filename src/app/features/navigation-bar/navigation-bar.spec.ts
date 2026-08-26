import {TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import axe from 'axe-core';
import {NavigationBar} from './navigation-bar';

describe('NavigationBar', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NavigationBar],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('shows the public-beta status beside the product brand', () => {
    const fixture = TestBed.createComponent(NavigationBar);
    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector('.public-beta-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent.trim()).toBe('Public beta');
    expect(fixture.nativeElement.querySelector('.header-title').textContent)
      .toContain('Job Seeker Copilot');
  });

  it('contains the only account actions and no duplicate workspace navigation', () => {
    const fixture = TestBed.createComponent(NavigationBar);
    fixture.componentRef.setInput('userName', 'Alex Taylor');
    fixture.componentRef.setInput('userEmail', 'alex@example.test');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('#btn-profile-dropdown').click();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('My profile');
    expect(text).toContain('Experience & achievements');
    expect(text).toContain('Sign out');
    expect(fixture.nativeElement.querySelector('.workspace-navigation')).toBeNull();
  });

  it('turns an exhausted balance into a clear generation-pack action', () => {
    const fixture = TestBed.createComponent(NavigationBar);
    fixture.componentRef.setInput('documentCreditBalance', 0);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.token-balance-pill');
    expect(trigger.textContent).toContain('Get generations');
    expect(trigger.textContent).not.toContain('0 generations');
    expect(trigger.getAttribute('aria-label')).toContain('No document generations remain');

    trigger.click();
    fixture.detectChanges();

    const text = fixture.nativeElement.querySelector('.token-dropdown').textContent;
    expect(text).toContain('No generations remaining');
    expect(text).toContain('Choose a one-off pack');
    expect(text).toContain('Choose a generation pack');
    expect(text).toContain('View generation history');
  });

  it('keeps the exact remaining balance for a non-empty allowance', () => {
    const fixture = TestBed.createComponent(NavigationBar);
    fixture.componentRef.setInput('documentCreditBalance', 7);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.token-balance-pill').textContent)
      .toContain('Documents: 7 generations');
    expect(fixture.nativeElement.querySelector('.token-balance-pill').textContent)
      .not.toContain('Get generations');
  });

  it('emits profile and experience destinations from the user menu', () => {
    const fixture = TestBed.createComponent(NavigationBar);
    const profile = vi.fn();
    const experience = vi.fn();
    fixture.componentInstance.openProfile.subscribe(profile);
    fixture.componentInstance.openExperience.subscribe(experience);
    fixture.detectChanges();

    fixture.componentInstance.triggerProfile();
    fixture.componentInstance.triggerExperience();

    expect(profile).toHaveBeenCalledOnce();
    expect(experience).toHaveBeenCalledOnce();
  });

  it('has no automated accessibility violations with its menu open', async () => {
    const fixture = TestBed.createComponent(NavigationBar);
    fixture.componentRef.setInput('userName', 'Alex Taylor');
    fixture.componentRef.setInput('userEmail', 'alex@example.test');
    fixture.detectChanges();
    fixture.componentInstance.toggleDropdown();
    fixture.detectChanges();

    const result = await axe.run(fixture.nativeElement, {
      rules: {'color-contrast': {enabled: false}},
    });
    expect(result.violations).toEqual([]);
  });

  it('has no automated accessibility violations in the exhausted-balance menu', async () => {
    const fixture = TestBed.createComponent(NavigationBar);
    fixture.componentRef.setInput('documentCreditBalance', 0);
    fixture.detectChanges();
    fixture.componentInstance.toggleTokenDropdown();
    fixture.detectChanges();

    const result = await axe.run(fixture.nativeElement, {
      rules: {'color-contrast': {enabled: false}},
    });
    expect(result.violations).toEqual([]);
  });
});
