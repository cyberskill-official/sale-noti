import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { MobileConfig, SearchSort } from "./types";

export type MobileTabKey = "search" | "track" | "watchlists" | "settings";
export type MobileWatchlistFilter = "active" | "paused" | "all";

export type MobileSessionSnapshot = {
  config: MobileConfig;
  activeTab: MobileTabKey;
  searchQuery: string;
  searchPage: string;
  searchSize: string;
  searchSort: SearchSort;
  trackUrl: string;
  trackNickname: string;
  watchlistFilter: MobileWatchlistFilter;
  watchlistPage: string;
  watchlistSize: string;
};

const STORAGE_KEY = "salenoti.mobile.session.v1";

function hasWebStorage(): boolean {
  return Platform.OS === "web" && typeof window !== "undefined" && Boolean(window.localStorage);
}

async function readRaw(): Promise<string | null> {
  if (hasWebStorage()) return window.localStorage.getItem(STORAGE_KEY);
  try {
    return await SecureStore.getItemAsync(STORAGE_KEY);
  } catch {
    return null;
  }
}

async function writeRaw(value: string): Promise<void> {
  if (hasWebStorage()) {
    window.localStorage.setItem(STORAGE_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEY, value);
}

async function deleteRaw(): Promise<void> {
  if (hasWebStorage()) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}

export async function loadMobileSession(): Promise<MobileSessionSnapshot | null> {
  const raw = await readRaw();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<MobileSessionSnapshot>;
    return coerceSnapshot(parsed);
  } catch {
    return null;
  }
}

export async function saveMobileSession(snapshot: MobileSessionSnapshot): Promise<void> {
  await writeRaw(JSON.stringify(snapshot));
}

export async function clearMobileSession(): Promise<void> {
  await deleteRaw();
}

function coerceSnapshot(snapshot: Partial<MobileSessionSnapshot> | null | undefined): MobileSessionSnapshot | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  if (!snapshot.config) return null;
  if (typeof snapshot.config.apiBaseUrl !== "string") return null;
  if (typeof snapshot.config.userId !== "string") return null;
  if (typeof snapshot.config.bearerToken !== "string") return null;

  return {
    config: {
      apiBaseUrl: snapshot.config.apiBaseUrl,
      userId: snapshot.config.userId,
      bearerToken: snapshot.config.bearerToken,
    },
    activeTab: isTabKey(snapshot.activeTab) ? snapshot.activeTab : "search",
    searchQuery: typeof snapshot.searchQuery === "string" ? snapshot.searchQuery : "",
    searchPage: typeof snapshot.searchPage === "string" ? snapshot.searchPage : "1",
    searchSize: typeof snapshot.searchSize === "string" ? snapshot.searchSize : "10",
    searchSort: isSearchSort(snapshot.searchSort) ? snapshot.searchSort : "RELEVANCY",
    trackUrl: typeof snapshot.trackUrl === "string" ? snapshot.trackUrl : "",
    trackNickname: typeof snapshot.trackNickname === "string" ? snapshot.trackNickname : "",
    watchlistFilter: isWatchlistFilter(snapshot.watchlistFilter) ? snapshot.watchlistFilter : "active",
    watchlistPage: typeof snapshot.watchlistPage === "string" ? snapshot.watchlistPage : "1",
    watchlistSize: typeof snapshot.watchlistSize === "string" ? snapshot.watchlistSize : "12",
  };
}

function isTabKey(value: unknown): value is MobileTabKey {
  return value === "search" || value === "track" || value === "watchlists" || value === "settings";
}

function isWatchlistFilter(value: unknown): value is MobileWatchlistFilter {
  return value === "active" || value === "paused" || value === "all";
}

function isSearchSort(value: unknown): value is SearchSort {
  return value === "RELEVANCY" || value === "PRICE_ASC" || value === "PRICE_DESC" || value === "SALES_DESC";
}
