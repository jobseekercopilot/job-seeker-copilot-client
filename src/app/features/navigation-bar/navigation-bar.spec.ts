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
});
