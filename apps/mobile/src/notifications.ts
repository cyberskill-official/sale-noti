// FR-NOTIF-004: Mobile push notifications lifecycle helper.
// Handles iOS/Android permission request and Expo push token acquisition.

import { Notification } from 'expo-notifications';

/**
 * Request user notification permission via platform-native UI.
 * The prompt MUST ONLY appear after explicit user tap of a Settings button.
 * Returns true if permission granted, false otherwise.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const existing = await Notification.getPermissionsAsync();
    if (existing.granted) {
      return true;
    }

    const response = await Notification.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
      android: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });

    return response.granted;
  } catch (error) {
    console.error('[notifications] permission request failed', error);
    return false;
  }
}

/**
 * Obtain the Expo push token after permission is granted.
 * The token is platform-dependent (Android = FCM, iOS = APNs via Expo).
 * Token string is opaque and MUST NOT be logged or exposed.
 */
export async function getExpoNotificationToken(): Promise<string | null> {
  try {
    const response = await Notification.getPermissionsAsync();
    if (!response.granted) {
      return null;
    }

    const { data } = await Notification.getExpoPushTokenAsync();
    return data ?? null;
  } catch (error) {
    console.error('[notifications] token fetch failed', error);
    return null;
  }
}

/**
 * Detect the native platform (android | ios).
 * Used to annotate the token when registering with the backend.
 */
export function detectPlatform(): 'android' | 'ios' {
  // Expo's Constants.platform.ios, Constants.platform.android, or rn Platform.
  // For now, we can detect via user agent on the web bundle.
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
    if (/Android/.test(ua)) return 'android';
  } catch {}

  // Fallback: use React Native's Platform API if available.
  try {
    const { Platform } = require('react-native');
    if (Platform.OS === 'ios') return 'ios';
    if (Platform.OS === 'android') return 'android';
  } catch {}

  // Default fallback.
  return 'android';
}

/**
 * Register native notification response handler.
 * Called when user taps a notification, passes the deep-link to the app.
 * @param handler Callback receiving the notification response data.
 */
export function setupNotificationResponseHandler(
  handler: (notification: Notification) => void,
): () => void {
  // Register subscription for notification taps.
  const subscription = Notification.addNotificationResponseReceivedListener((response) => {
    handler(response.notification);
  });

  // Return unsubscriber.
  return () => {
    subscription.remove();
  };
}
