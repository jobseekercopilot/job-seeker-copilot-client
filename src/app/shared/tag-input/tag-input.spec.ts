import { TestBed } from '@angular/core/testing';
import { TagInputComponent } from './tag-input';

describe('TagInputComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TagInputComponent]
    }).compileComponents();
  });

  it('adds multiple tags across comma and Enter commits', () => {
    const component = TestBed.createComponent(TagInputComponent).componentInstance;

    component.inputValue.set('Customer service');
    component.handleKeydown(new KeyboardEvent('keydown', { key: ',' }));
    component.inputValue.set('Office administration');
    component.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(component.tags()).toEqual(['Customer service', 'Office administration']);
    expect(component.inputValue()).toBe('');
  });

  it('adds comma-separated pasted values and keeps tags removable', () => {
    const component = TestBed.createComponent(TagInputComponent).componentInstance;
    component.inputValue.set('Reception, Data entry');

    component.commitInput();
    component.removeTag(0);

    expect(component.tags()).toEqual(['Data entry']);
  });
});
