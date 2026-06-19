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

export class LocationGateway {
  private gatewayUrl = process.env['LOCATION_GATEWAY_URL'] || 'http://location-gateway:8081';

  /**
   * Gateway transaction logger simulating enterprise audit security logs
   */
  private logTransaction(action: string, query: string, matchesCount: number) {
    const timestamp = new Date().toISOString();
    console.log(`[LocationGateway API ${timestamp}] ACTION: ${action} | QUERY: "${query}" | MATCHES: ${matchesCount}`);
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
      const response = await fetch(`${this.gatewayUrl}/api/locations?q=${encodeURIComponent(cleanQuery)}`);
      const data = await response.json() as LocationGatewayResponse;
      
      this.logTransaction('SEARCH_LOCATIONS', cleanQuery, data.locations?.length || 0);
      return data;
    } catch (error) {
      console.error('[LocationGateway] Error calling location gateway service:', error);
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
      const response = await fetch(`${this.gatewayUrl}/api/postcodes/${encodeURIComponent(cleanPostcode)}`);
      const data = await response.json() as LocationGatewayResponse;
      
      this.logTransaction('GET_BY_POSTCODE', cleanPostcode, data.locations?.length || 0);
      return data;
    } catch (error) {
      console.error('[LocationGateway] Error calling postcode gateway service:', error);
      return {
        statusCode: 500,
        success: false,
        message: 'Error calling postcode gateway service',
        locations: []
      };
    }
  }
}
