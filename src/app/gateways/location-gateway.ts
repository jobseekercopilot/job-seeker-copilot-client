import {fetchTextWithTimeout} from '../../server/bff-boundary';

export interface UKLocation {
  id: string;
  name: string;
  postcode: string;
  region: string;
}

export interface LocationGatewayResponse {
  statusCode: number;
  success: boolean;
  message: string;
  locations: UKLocation[];
}

export interface LocationV2GatewayResponse {
  statusCode: number;
  contentType: string;
  body: string;
}

export class LocationGateway {
  constructor(
    private readonly timeoutMs = 5_000,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly gatewayUrl =
      process.env['LOCATION_GATEWAY_URL'] || 'http://location-gateway:8081',
  ) {}

  /**
   * Gateway transaction logger simulating enterprise audit security logs
   */
  private logTransaction(action: string, matchesCount: number) {
    const timestamp = new Date().toISOString();
    console.log(`[LocationGateway API ${timestamp}] ACTION: ${action} | MATCHES: ${matchesCount}`);
  }

  /**
   * Look up matching UK location entries securely from backend
   */
  public async handleSearch(query: string): Promise<LocationGatewayResponse> {
    const cleanQuery = (query || '').trim();

    if (!cleanQuery) {
      return {
        statusCode: 200,
        success: true,
        message: 'Empty query returned no matches.',
        locations: []
      };
    }

    try {
      const {body} = await fetchTextWithTimeout(
        `${this.gatewayUrl}/api/locations?q=${encodeURIComponent(cleanQuery)}`,
        {},
        this.timeoutMs,
        this.fetchImplementation,
      );
      const data = JSON.parse(body) as LocationGatewayResponse;
      
      this.logTransaction('SEARCH_LOCATIONS', data.locations?.length || 0);
      return data;
    } catch {
      console.error('[LocationGateway] Error calling location gateway service');
      return {
        statusCode: 500,
        success: false,
        message: 'Error calling location gateway service',
        locations: []
      };
    }
  }

  /**
   * Look up UK location by postcode securely from backend
   */
  public async handlePostcode(postcode: string): Promise<LocationGatewayResponse> {
    const cleanPostcode = (postcode || '').trim();

    if (!cleanPostcode) {
      return {
        statusCode: 200,
        success: true,
        message: 'Empty postcode returned no matches.',
        locations: []
      };
    }

    try {
      const {body} = await fetchTextWithTimeout(
        `${this.gatewayUrl}/api/postcodes/${encodeURIComponent(cleanPostcode)}`,
        {},
        this.timeoutMs,
        this.fetchImplementation,
      );
      const data = JSON.parse(body) as LocationGatewayResponse;
      
      this.logTransaction('GET_BY_POSTCODE', data.locations?.length || 0);
      return data;
    } catch {
      console.error('[LocationGateway] Error calling postcode gateway service');
      return {
        statusCode: 500,
        success: false,
        message: 'Error calling postcode gateway service',
        locations: []
      };
    }
  }

  public handleAutocomplete(payload: unknown): Promise<LocationV2GatewayResponse> {
    return this.handleV2Request('autocomplete', payload);
  }

  public handleResolve(payload: unknown): Promise<LocationV2GatewayResponse> {
    return this.handleV2Request('resolve', payload);
  }

  private async handleV2Request(
    action: 'autocomplete' | 'resolve',
    payload: unknown,
  ): Promise<LocationV2GatewayResponse> {
    try {
      const {body, response} = await fetchTextWithTimeout(
        `${this.gatewayUrl}/api/v2/locations/${action}`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(payload),
        },
        this.timeoutMs,
        this.fetchImplementation,
      );
      return {
        statusCode: response.status,
        contentType: response.headers.get('content-type') || 'application/json',
        body,
      };
    } catch {
      console.error(`[LocationGateway] ${action} request unavailable`);
      return {
        statusCode: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'LOCATION_GATEWAY_UNAVAILABLE',
          message: 'Location search is temporarily unavailable. Try again.',
        }),
      };
    }
  }
}
