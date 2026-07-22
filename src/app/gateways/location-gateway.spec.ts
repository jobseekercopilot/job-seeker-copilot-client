import {LocationGateway, type LocationGatewayResponse} from './location-gateway';

describe('LocationGateway privacy boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('encodes a trimmed place query but records only action and match count', async () => {
    const sensitiveQuery = 'St Albans';
    const response: LocationGatewayResponse = {
      statusCode: 200,
      success: true,
      message: 'Locations retrieved.',
      locations: [{id: 'place-1', name: sensitiveQuery, postcode: 'AL1', region: 'East of England'}],
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(response)));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await new LocationGateway().handleSearch(`  ${sensitiveQuery}  `);

    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith('http://location-gateway:8081/api/locations?q=St%20Albans');
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls.flat().join(' ')).toContain('ACTION: SEARCH_LOCATIONS | MATCHES: 1');
    expect(log.mock.calls.flat().join(' ')).not.toContain(sensitiveQuery);
  });

  it('does not log a failed place query, upstream URL, or exception detail', async () => {
    const sensitiveQuery = 'Private Search';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error(`request failed for http://private.internal/places?q=${sensitiveQuery}`),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await new LocationGateway().handleSearch(sensitiveQuery);

    expect(result).toEqual({
      statusCode: 500,
      success: false,
      message: 'Error calling location gateway service',
      locations: [],
    });
    expect(error).toHaveBeenCalledWith('[LocationGateway] Error calling location gateway service');
    expect(error.mock.calls.flat().join(' ')).not.toContain(sensitiveQuery);
    expect(error.mock.calls.flat().join(' ')).not.toContain('private.internal');
  });

  it('does not log a postcode on success', async () => {
    const sensitivePostcode = 'SW1A 1AA';
    const response: LocationGatewayResponse = {
      statusCode: 200,
      success: true,
      message: 'Location retrieved.',
      locations: [{id: 'postcode-1', name: 'Westminster', postcode: sensitivePostcode, region: 'London'}],
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(response)));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await new LocationGateway().handlePostcode(` ${sensitivePostcode} `);

    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith('http://location-gateway:8081/api/postcodes/SW1A%201AA');
    expect(log.mock.calls.flat().join(' ')).toContain('ACTION: GET_BY_POSTCODE | MATCHES: 1');
    expect(log.mock.calls.flat().join(' ')).not.toContain(sensitivePostcode);
  });

  it('does not log a failed postcode or exception detail', async () => {
    const sensitivePostcode = 'EH1 1AA';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error(`failed postcode ${sensitivePostcode}`));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await new LocationGateway().handlePostcode(sensitivePostcode);

    expect(result.statusCode).toBe(500);
    expect(error).toHaveBeenCalledWith('[LocationGateway] Error calling postcode gateway service');
    expect(error.mock.calls.flat().join(' ')).not.toContain(sensitivePostcode);
  });
});
