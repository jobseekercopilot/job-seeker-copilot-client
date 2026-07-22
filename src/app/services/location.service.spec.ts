import {TestBed} from '@angular/core/testing';
import {firstValueFrom, of, throwError, toArray} from 'rxjs';
import {LocationService as GeneratedLocationService} from '../api/location';
import {idleLocationLookup, LocationService} from './location.service';

describe('LocationService lookup states', () => {
  const searchLocations = vi.fn();
  const getLocationByPostcode = vi.fn();
  let service: LocationService;

  beforeEach(() => {
    searchLocations.mockReset();
    getLocationByPostcode.mockReset();
    TestBed.configureTestingModule({
      providers: [
        LocationService,
        {
          provide: GeneratedLocationService,
          useValue: {searchLocations, getLocationByPostcode},
        },
      ],
    });
    service = TestBed.inject(LocationService);
  });

  it('does not request empty or partial input', async () => {
    await expect(firstValueFrom(service.lookup(' A '))).resolves.toEqual(idleLocationLookup);
    expect(searchLocations).not.toHaveBeenCalled();
    expect(getLocationByPostcode).not.toHaveBeenCalled();
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
    searchLocations.mockReturnValue(of({success: true, statusCode: 200, locations: [location]}));

    const states = await firstValueFrom(service.lookup('  Leeds  ').pipe(toArray()));

    expect(searchLocations).toHaveBeenCalledWith('Leeds');
    expect(getLocationByPostcode).not.toHaveBeenCalled();
    expect(states).toEqual([
      {status: 'loading', locations: [], message: 'Searching locations…'},
      {status: 'results', locations: [location], message: '1 matching location found.'},
    ]);
  });

  it('routes a postcode or outcode to the postcode endpoint', async () => {
    getLocationByPostcode.mockReturnValue(of({success: true, statusCode: 200, locations: []}));

    const states = await firstValueFrom(service.lookup('  SW1A 1AA  ').pipe(toArray()));

    expect(getLocationByPostcode).toHaveBeenCalledWith('SW1A 1AA');
    expect(searchLocations).not.toHaveBeenCalled();
    expect(states.at(-1)).toEqual({
      status: 'empty',
      locations: [],
      message: 'No matching locations found.',
    });
  });

  it.each([
    [400, 'invalid', 'Enter a valid UK location or postcode.'],
    [404, 'empty', 'No matching locations found.'],
    [429, 'rate-limited', 'Too many location searches. Try again shortly.'],
    [0, 'unavailable', 'Location search is temporarily unavailable. Try again.'],
    [503, 'unavailable', 'Location search is temporarily unavailable. Try again.'],
  ] as const)('maps HTTP %s to a stable %s state without upstream detail', async (status, expectedStatus, message) => {
    searchLocations.mockReturnValue(throwError(() => ({
      status,
      error: {message: 'private provider URL and response'},
    })));

    const states = await firstValueFrom(service.lookup('Leeds').pipe(toArray()));

    expect(states.at(-1)).toEqual({status: expectedStatus, locations: [], message});
    expect(JSON.stringify(states)).not.toContain('private provider');
  });
});
