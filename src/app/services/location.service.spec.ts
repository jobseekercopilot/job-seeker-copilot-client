import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {firstValueFrom, toArray} from 'rxjs';
import {LocationService as GeneratedLocationService} from '../api/location';
import {idleLocationLookup, locationFailureState, LocationService} from './location.service';

describe('LocationService lookup states', () => {
  const searchLocations = vi.fn();
  const getLocationByPostcode = vi.fn();
  let service: LocationService;
  let http: HttpTestingController;

  beforeEach(() => {
    searchLocations.mockReset();
    getLocationByPostcode.mockReset();
    TestBed.configureTestingModule({
      providers: [
        LocationService,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: GeneratedLocationService,
          useValue: {searchLocations, getLocationByPostcode},
        },
      ],
    });
    service = TestBed.inject(LocationService);
    http = TestBed.inject(HttpTestingController);
  });

  it('does not request empty or partial input', async () => {
    await expect(firstValueFrom(service.lookup(' A '))).resolves.toEqual(idleLocationLookup);
    expect(searchLocations).not.toHaveBeenCalled();
    expect(getLocationByPostcode).not.toHaveBeenCalled();
    http.verify();
  });

  it('trims a place query and exposes loading followed by canonical results', async () => {
    const location = {
      id: 'place-1',
      name: 'Leeds',
      postcode: 'LS1',
      region: 'Yorkshire and the Humber',
      latitude: 53.8,
      longitude: -1.55,
    };
    const result = firstValueFrom(service.lookup('  Leeds  ').pipe(toArray()));
    const request = http.expectOne('/api/v2/locations/autocomplete');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({input: 'Leeds', countryCodes: ['GB']});
    request.flush({
      sessionId: 'session-1',
      suggestions: [{
        suggestionId: location.id,
        primaryText: location.name,
        secondaryText: location.region,
        precisionHint: 'LOCALITY_CENTROID',
      }],
    });
    const states = await result;
    expect(states).toEqual([
      {status: 'loading', locations: [], message: 'Searching locations…'},
      {status: 'results', locations: [expect.objectContaining({
        id: 'place-1', sessionId: 'session-1', suggestionId: 'place-1', name: 'Leeds, Yorkshire and the Humber',
      })], message: '1 matching location found.'},
    ]);
  });

  it('keeps postcode searches inside the v2 gateway flow', async () => {
    const result = firstValueFrom(service.lookup('  SW1A 1AA  ').pipe(toArray()));
    const request = http.expectOne('/api/v2/locations/autocomplete');
    expect(request.request.body.input).toBe('SW1A 1AA');
    request.flush({sessionId: 'session-2', suggestions: []});
    const states = await result;
    expect(states.at(-1)).toEqual({
      status: 'empty',
      locations: [],
      message: 'No matching locations found.',
    });
  });

  it.each([
    [400, 'invalid', 'Enter a valid UK location or postcode.'],
    [404, 'empty', 'No matching locations found.'],
    [422, 'unsupported', 'This postcode area is not currently supported.'],
    [429, 'rate-limited', 'Too many location searches. Try again shortly.'],
    [0, 'unavailable', 'Location search is temporarily unavailable. Try again.'],
    [503, 'unavailable', 'Location search is temporarily unavailable. Try again.'],
  ] as const)('maps HTTP %s to a stable %s state without upstream detail', async (status, expectedStatus, message) => {
    const result = firstValueFrom(service.lookup('Leeds').pipe(toArray()));
    const request = http.expectOne('/api/v2/locations/autocomplete');
    request.flush({message: 'private provider URL and response'}, {status, statusText: 'provider failure'});
    const states = await result;

    expect(states.at(-1)).toEqual({status: expectedStatus, locations: [], message});
    expect(JSON.stringify(states)).not.toContain('private provider');
  });

  it('maps an unsupported resolution response without echoing the postcode', () => {
    const state = locationFailureState({
      status: 422,
      error: {message: 'BT1 1AA is outside approved coverage'},
    });

    expect(state).toEqual({
      status: 'unsupported',
      locations: [],
      message: 'This postcode area is not currently supported.',
    });
    expect(JSON.stringify(state)).not.toContain('BT1 1AA');
  });
});
