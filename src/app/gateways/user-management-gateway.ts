import { Injectable, Optional, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface UserProfile {
  name: string;
  email: string;
  skills: string;
  experience: string;
  aspirations: string;
  workPrefs: string;
}

export interface GatewayResponse {
  statusCode: number;
  success: boolean;
  message: string;
  user?: {
    id: string;
    name: string;
    email: string;
    token: string;
    profile: UserProfile;
  };
}

@Injectable({ providedIn: 'root' })
export class UserManagementGateway {
  private gatewayUrl: string;

  constructor(@Optional() @Inject(PLATFORM_ID) platformId?: object) {
    if (platformId && isPlatformBrowser(platformId)) {
      this.gatewayUrl = '';
    } else {
      this.gatewayUrl = process.env['USER_MANAGEMENT_GATEWAY_URL'] || 'http://user-management-gateway:8083';
    }
  }

  private logTransaction(action: string, email: string, outcome: string) {
    const timestamp = new Date().toISOString();
    console.log(`[UserManagementGateway Client ${timestamp}] ACTION: ${action} | SUBJECT: ${email} | OUTCOME: ${outcome}`);
  }

  public async handleRegistration(
    name: string,
    email: string,
    psw: string,
    profile: UserProfile
  ): Promise<GatewayResponse> {
    const cleanEmail = (email || '').trim().toLowerCase();
    try {
      const response = await fetch(`${this.gatewayUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email: cleanEmail,
          password: psw,
          profile
        })
      });
      const data = await response.json() as GatewayResponse;
      this.logTransaction('REGISTER', cleanEmail, `STATUS ${data.statusCode} - ${data.message}`);
      return data;
    } catch (error) {
      console.error('[UserManagementGateway Client] Error calling register service:', error);
      return {
        statusCode: 500,
        success: false,
        message: 'Error calling user-management register service.'
      };
    }
  }

  public async handleLogin(email: string, psw: string): Promise<GatewayResponse> {
    const cleanEmail = (email || '').trim().toLowerCase();
    try {
      const response = await fetch(`${this.gatewayUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          password: psw
        })
      });
      const data = await response.json() as GatewayResponse;
      this.logTransaction('LOGIN', cleanEmail, `STATUS ${data.statusCode} - ${data.message}`);
      return data;
    } catch (error) {
      console.error('[UserManagementGateway Client] Error calling login service:', error);
      return {
        statusCode: 500,
        success: false,
        message: 'Error calling user-management login service.'
      };
    }
  }

  public async handleGetProfile(email: string): Promise<GatewayResponse> {
    const cleanEmail = (email || '').trim().toLowerCase();
    try {
      const response = await fetch(`${this.gatewayUrl}/api/auth/profile?email=${encodeURIComponent(cleanEmail)}`);
      const data = await response.json() as GatewayResponse;
      this.logTransaction('GET_PROFILE', cleanEmail, `STATUS ${data.statusCode} - ${data.message}`);
      return data;
    } catch (error) {
      console.error('[UserManagementGateway Client] Error calling profile service:', error);
      return {
        statusCode: 500,
        success: false,
        message: 'Error calling user-management profile service.'
      };
    }
  }

  public async handleUpdateProfile(
    email: string,
    profile: UserProfile,
    token?: string
  ): Promise<GatewayResponse> {
    const cleanEmail = (email || '').trim().toLowerCase();
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      if (token) {
        headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
      }

      const response = await fetch(`${this.gatewayUrl}/api/auth/profile?email=${encodeURIComponent(cleanEmail)}`, {
        method: 'PUT',
        headers: headers,
        body: JSON.stringify(profile)
      });

      const data = await response.json() as GatewayResponse;
      this.logTransaction('UPDATE_PROFILE', cleanEmail, `STATUS ${data.statusCode} - ${data.message}`);
      return data;
    } catch (error) {
      console.error('[UserManagementGateway Client] Error calling update profile service:', error);
      return {
        statusCode: 500,
        success: false,
        message: 'Error calling user-management update profile service.'
      };
    }
  }
}