import {TestBed} from '@angular/core/testing';
import {BetaApp} from './beta-app';

describe('BetaApp', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BetaApp],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(BetaApp);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
