import {LocationGateway, LocationGatewayResponse} from './location-gateway';
import {afterEach, describe, expect, it, vi} from 'vitest';

describe('LocationGateway', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not write a successful place query to logs', async () => {
    const sensitiveQuery = 'Private Place';
    const response: LocationGatewayResponse = {
      statusCode: 200,
      success: true,
      message: 'Locations retrieved.',
      locations: [{id: 'place-1', name: 'Private Place', postcode: 'LS1', region: 'Yorkshire'}],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(response)));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await new LocationGateway().handleSearch(sensitiveQuery);

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls.flat().join(' ')).not.toContain(sensitiveQuery);
  });

  it('does not write a failed place query or upstream error detail to logs', async () => {
    const sensitiveQuery = 'Secret Search';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error(`request failed for ?q=${sensitiveQuery}`),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await new LocationGateway().handleSearch(sensitiveQuery);

    expect(result.statusCode).toBe(500);
    expect(error.mock.calls.flat().join(' ')).not.toContain(sensitiveQuery);
  });
});
