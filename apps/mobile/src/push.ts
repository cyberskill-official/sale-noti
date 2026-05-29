// FR-NOTIF-004: Mobile push token registration and click beacon helper.
// Bridges mobile notification lifecycle to backend subscribe/unsubscribe/clicked endpoints.

import { Notification } from 'expo-notifications';
import { detectPlatform, getExpoNotificationToken } from './notifications';

export interface MobilePushToken {
  token: string;
  platform: 'android' | 'ios';
  deviceId?: string;
  appVersion?: string;
}

export interface MobilePushSubscribeRequest extends MobilePushToken {
  // deviceId and appVersion are optional metadata.
}

export interface MobilePushSubscribeResponse {
  ok: boolean;
  deviceCount?: number;
  error?: string;
}

/**
 * Register the device's push token with the backend.
 * MUST be called only after the user has explicitly tapped "Enable mobile notifications"
 * and the native permission prompt has been shown.
 *
 * @param apiBaseUrl Backend API base URL.
 * @param userId User ID from session.
 * @param bearerToken Optional bearer token for auth.
 * @param appVersion Optional app version string for metadata.
 * @returns true if subscription succeeded, false otherwise.
 */
export async function subscribePushToken(
  apiBaseUrl: string,
  userId: string,
  bearerToken: string,
  appVersion?: string,
): Promise<boolean> {
  try {
    const token = await getExpoNotificationToken();
    if (!token) {
      console.error('[push] Failed to obtain Expo push token');
      return false;
    }

    const platform = detectPlatform();
    const payload: MobilePushSubscribeRequest = {
      token,
      platform,
      appVersion,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
    };

    if (bearerToken) {
      headers['Authorization'] = `Bearer ${bearerToken}`;
    }

    const url = `${apiBaseUrl.replace(/\/$/, '')}/v1/me/mobile-push/subscribe`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'unknown' }));
      console.error('[push] Subscribe failed:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[push] Subscribe threw:', error);
    return false;
  }
}

/**
 * Unsubscribe a specific token or all tokens for the user.
 * @param apiBaseUrl Backend API base URL.
 * @param userId User ID from session.
 * @param bearerToken Optional bearer token for auth.
 * @param token Optional specific token to remove; if omitted, clears all.
 */
export async function unsubscribePushToken(
  apiBaseUrl: string,
  userId: string,
  bearerToken: string,
  token?: string,
): Promise<boolean> {
  try {
    const payload = token ? { token } : {};

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
    };

    if (bearerToken) {
      headers['Authorization'] = `Bearer ${bearerToken}`;
    }

    const url = `${apiBaseUrl.replace(/\/$/, '')}/v1/me/mobile-push/unsubscribe`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error('[push] Unsubscribe failed:', response.status);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[push] Unsubscribe threw:', error);
    return false;
  }
}

/**
 * Emit a click beacon to the backend when user taps a push notification.
 * Updates notifications.clickedAt for audit/attribution.
 *
 * @param apiBaseUrl Backend API base URL.
 * @param idem Idempotency key from the notification's data.url query param.
 */
export async function emitPushClickBeacon(apiBaseUrl: string, idem: string): Promise<void> {
  try {
    const url = `${apiBaseUrl.replace(/\/$/, '')}/v1/me/mobile-push/clicked`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idem }),
      // Use keepalive: true to ensure the beacon fires even if the app closes.
      keepalive: true,
    });

    if (!response.ok) {
      console.error('[push] Click beacon failed:', response.status);
    }
  } catch (error) {
    console.error('[push] Click beacon threw:', error);
  }
}

/**
 * Extract the idempotency key from a deep-link URL.
 * Deep link shape: salenoti://watchlists/<id>?utm=mobilePush&idem=...
 */
export function extractIdemFromDeepLink(url: string): string | null {
  try {
    const parsed = new URL(url.replace(/^salenoti:\/\//, 'https://salenoti.app/'));
    return parsed.searchParams.get('idem');
  } catch {
    return null;
  }
}
