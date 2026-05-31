import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, FlatList, Image, Linking, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AFFILIATE_DISCLOSURE_VI, DISCLOSURE_VERSION, FIVE_PRINCIPLES_VI } from '@salenoti/disclosure-copy';
import {
  clearMobileSession,
  loadMobileSession,
  saveMobileSession,
  type MobileSessionSnapshot,
  type MobileTabKey as TabKey,
  type MobileWatchlistFilter as WatchlistFilter,
} from './src/persistence';
import {
  buildShopeeProductUrl,
  defaultApiBaseUrl,
  deleteWatchlist,
  fetchWatchlists,
  normalizeApiBaseUrl,
  searchProducts,
  trackProduct,
  updateWatchlist,
} from './src/api';
import {
  requestNotificationPermission,
  setupNotificationResponseHandler,
} from './src/notifications';
import {
  subscribePushToken,
  unsubscribePushToken,
  emitPushClickBeacon,
  extractIdemFromDeepLink,
} from './src/push';
import {
  type MobileConfig,
  type SearchResult,
  type SearchSort,
  type TrackResult,
  type WatchlistItem,
  type WatchlistListResult,
} from './src/types';

const TABS: Array<{ key: TabKey; label: string; description: string }> = [
  { key: 'search', label: 'Search', description: 'Tìm sản phẩm' },
  { key: 'track', label: 'Track', description: 'Ghim URL' },
  { key: 'watchlists', label: 'Watchlists', description: 'Danh sách' },
  { key: 'settings', label: 'Settings', description: 'Kết nối' },
];

const SEARCH_SORT_OPTIONS: Array<{ label: string; value: SearchSort }> = [
  { label: 'Relevancy', value: 'RELEVANCY' },
  { label: 'Price +', value: 'PRICE_ASC' },
  { label: 'Price -', value: 'PRICE_DESC' },
  { label: 'Sales', value: 'SALES_DESC' },
];

const WATCHLIST_FILTER_OPTIONS: Array<{ label: string; value: WatchlistFilter }> = [
  { label: 'Active', value: 'active' },
  { label: 'Paused', value: 'paused' },
  { label: 'All', value: 'all' },
];

const COLORS = {
  background: '#F4EFE6',
  surface: '#FFFDF8',
  surfaceAlt: '#F8F3EA',
  card: '#FFFFFF',
  ink: '#12212B',
  muted: '#5C6673',
  line: 'rgba(18, 33, 43, 0.12)',
  accent: '#0F766E',
  accentSoft: 'rgba(15, 118, 110, 0.12)',
  accentAlt: '#D97757',
  success: '#166534',
  warning: '#9A3412',
  danger: '#B42318',
  shadow: '#0D1B2A',
};

const HIGHLIGHT_FONT = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) ?? 'serif';

function createDefaultConfig(): MobileConfig {
  return {
    apiBaseUrl: defaultApiBaseUrl(),
    userId: process.env.EXPO_PUBLIC_SALENOTI_USER_ID?.trim() || '',
    bearerToken: process.env.EXPO_PUBLIC_SALENOTI_BEARER_TOKEN?.trim() || '',
  };
}

function createEmptyConfig(): MobileConfig {
  return {
    apiBaseUrl: defaultApiBaseUrl(),
    userId: '',
    bearerToken: '',
  };
}

function localFallbackApiBaseUrl(): string {
  return Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
}

function canonicalizeConfiguredApiBaseUrl(raw: string | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  return normalizeApiBaseUrl(raw);
}

function resolveRestoredApiBaseUrl(apiBaseUrl: string): string {
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
  const managedBaseUrls = new Set(
    [
      canonicalizeConfiguredApiBaseUrl(process.env.EXPO_PUBLIC_SALENOTI_API_BASE_URL),
      canonicalizeConfiguredApiBaseUrl(process.env.EXPO_PUBLIC_SALENOTI_API_BASE_URL_SG),
      canonicalizeConfiguredApiBaseUrl(process.env.EXPO_PUBLIC_SALENOTI_API_BASE_URL_US),
      localFallbackApiBaseUrl(),
    ].filter((value): value is string => Boolean(value))
  );

  return managedBaseUrls.has(normalizedApiBaseUrl) ? defaultApiBaseUrl() : normalizedApiBaseUrl;
}

const DEFAULT_SEARCH_QUERY = process.env.EXPO_PUBLIC_SALENOTI_DEFAULT_QUERY?.trim() || 'áo thun';
const DEFAULT_SEARCH_PAGE = '1';
const DEFAULT_SEARCH_SIZE = '10';
const DEFAULT_WATCHLIST_PAGE = '1';
const DEFAULT_WATCHLIST_SIZE = '12';

function formatVnd(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return `${value.toLocaleString('vi-VN')} đ`;
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return `${value}%`;
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '--';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function shortProductLabel(productId: string): string {
  const [shopId, itemId] = productId.split('-');
  return shopId && itemId ? `${shopId}.${itemId}` : productId;
}

function friendlyApiError(error: unknown): string {
  if (error && typeof error === 'object' && 'status' in error) {
    const typedError = error as { status: number; payload: { error?: string; message?: string; retryAfter?: number; upgradeUrl?: string } | null };
    const payload = typedError.payload;
    if (payload?.error === 'invalid_shopee_url') return 'URL Shopee không hợp lệ.';
    if (payload?.error === 'product_not_available') return payload.message ?? 'Sản phẩm chưa có trong catalog.';
    if (payload?.error === 'free_tier_cap_reached') return `Đã chạm giới hạn free tier. ${payload.upgradeUrl ?? ''}`.trim();
    if (payload?.error === 'RATE_LIMIT_TRACK') {
      return payload.retryAfter ? `Bị giới hạn track, thử lại sau ${payload.retryAfter}s.` : 'Bị giới hạn track.';
    }
    if (payload?.error === 'rate_limit') {
      return payload.retryAfter ? `Bị giới hạn rate, thử lại sau ${payload.retryAfter}s.` : 'Bị giới hạn rate.';
    }
    if (payload?.error === 'unauthenticated' || payload?.error === 'UNAUTHENTICATED') {
      return 'Thiếu user id hoặc bearer token.';
    }
    if (payload?.error === 'validation_failed') return 'Payload chưa hợp lệ.';
    if (payload?.message) return payload.message;
    return `API ${typedError.status}`;
  }
  if (error instanceof Error) return error.message;
  return 'Không xác định được lỗi.';
}

function productUrlFromId(productId: string): string {
  const [shopId, itemId] = productId.split('-');
  return buildShopeeProductUrl(shopId ?? productId, itemId ?? productId);
}

function toInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function App() {
  const heroOpacity = useRef(new Animated.Value(0)).current;
  const heroOffset = useRef(new Animated.Value(18)).current;

  const [activeTab, setActiveTab] = useState<TabKey>('search');
  const [banner, setBanner] = useState<string | null>(null);
  const [config, setConfig] = useState<MobileConfig>(createDefaultConfig);

  const [searchQuery, setSearchQuery] = useState(process.env.EXPO_PUBLIC_SALENOTI_DEFAULT_QUERY?.trim() || 'áo thun');
  const [searchPage, setSearchPage] = useState('1');
  const [searchSize, setSearchSize] = useState('10');
  const [searchSort, setSearchSort] = useState<SearchSort>('RELEVANCY');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);

  const [trackUrl, setTrackUrl] = useState('');
  const [trackNickname, setTrackNickname] = useState('');
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [trackResult, setTrackResult] = useState<TrackResult | null>(null);

  const [watchlistFilter, setWatchlistFilter] = useState<WatchlistFilter>('active');
  const [watchlistPage, setWatchlistPage] = useState('1');
  const [watchlistSize, setWatchlistSize] = useState('12');
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [watchlistResult, setWatchlistResult] = useState<WatchlistListResult | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  // FR-NOTIF-004: Mobile push notification state
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(heroOpacity, {
        toValue: 1,
        duration: 520,
        useNativeDriver: true,
      }),
      Animated.timing(heroOffset, {
        toValue: 0,
        duration: 520,
        useNativeDriver: true,
      }),
    ]).start();
  }, [heroOpacity, heroOffset]);

  useEffect(() => {
    if (!sessionReady || activeTab !== 'watchlists') {
      return;
    }
    void loadWatchlists();
  }, [activeTab, sessionReady]);

  // FR-NOTIF-004: Setup notification response handler on mount.
  useEffect(() => {
    const unsubscribe = setupNotificationResponseHandler((notification) => {
      // Extract deep-link URL and idem from notification data.
      const url = notification.request.content.data?.url as string | undefined;
      const idem = extractIdemFromDeepLink(url || '');

      if (url) {
        // Deep link to watchlists tab with the watchlist ID from the URL.
        // The URL shape is salenoti://watchlists/<watchlistId>?utm=mobilePush&idem=...
        const match = url.match(/watchlists\/([^?]+)/);
        if (match?.[1]) {
          setActiveTab('watchlists');
        }
      }

      // Emit click beacon if idem was present.
      if (idem && config.apiBaseUrl) {
        void emitPushClickBeacon(config.apiBaseUrl, idem);
      }
    });

    return unsubscribe;
  }, [config.apiBaseUrl]);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession(): Promise<void> {
      try {
        const snapshot = await loadMobileSession();
        if (cancelled) return;

        if (snapshot) {
          applySessionSnapshot(snapshot);
          setSessionNotice('Đã khôi phục session đã lưu trên thiết bị.');
        } else {
          setSessionNotice('Chưa có session lưu; đang dùng giá trị mặc định.');
        }
      } catch {
        if (!cancelled) {
          setSessionNotice('Không đọc được session lưu; đang dùng giá trị mặc định.');
        }
      } finally {
        if (!cancelled) setSessionReady(true);
      }
    }

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionReady) return;

    const snapshot = buildSessionSnapshot();
    const timer = setTimeout(() => {
      void saveMobileSession(snapshot).catch(() => {
        setSessionNotice('Không lưu được session trên thiết bị.');
      });
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [sessionReady, activeTab, config, searchQuery, searchPage, searchSize, searchSort, trackUrl, trackNickname, watchlistFilter, watchlistPage, watchlistSize]);

  function buildSessionSnapshot(): MobileSessionSnapshot {
    return {
      config,
      activeTab,
      searchQuery,
      searchPage,
      searchSize,
      searchSort,
      trackUrl,
      trackNickname,
      watchlistFilter,
      watchlistPage,
      watchlistSize,
    };
  }

  function applySessionSnapshot(snapshot: MobileSessionSnapshot): void {
    setConfig({
      ...snapshot.config,
      apiBaseUrl: resolveRestoredApiBaseUrl(snapshot.config.apiBaseUrl),
    });
    setActiveTab(snapshot.activeTab);
    setSearchQuery(snapshot.searchQuery);
    setSearchPage(snapshot.searchPage);
    setSearchSize(snapshot.searchSize);
    setSearchSort(snapshot.searchSort);
    setTrackUrl(snapshot.trackUrl);
    setTrackNickname(snapshot.trackNickname);
    setWatchlistFilter(snapshot.watchlistFilter);
    setWatchlistPage(snapshot.watchlistPage);
    setWatchlistSize(snapshot.watchlistSize);
  }

  async function clearPersistedSession(): Promise<void> {
    try {
      await clearMobileSession();
    } finally {
      setConfig(createEmptyConfig());
      setActiveTab('settings');
      setSearchQuery(DEFAULT_SEARCH_QUERY);
      setSearchPage(DEFAULT_SEARCH_PAGE);
      setSearchSize(DEFAULT_SEARCH_SIZE);
      setSearchSort('RELEVANCY');
      setSearchResult(null);
      setSearchError(null);
      setTrackUrl('');
      setTrackNickname('');
      setTrackResult(null);
      setTrackError(null);
      setWatchlistFilter('active');
      setWatchlistPage(DEFAULT_WATCHLIST_PAGE);
      setWatchlistSize(DEFAULT_WATCHLIST_SIZE);
      setWatchlistResult(null);
      setWatchlistError(null);
      setBanner(null);
      setSessionNotice('Đã xoá session lưu trên thiết bị.');
      setSessionReady(true);
    }
  }

  async function loadSearch(): Promise<void> {
    setSearchLoading(true);
    setSearchError(null);
    setBanner(null);
    try {
      const result = await searchProducts(config, {
        q: searchQuery.trim(),
        page: toInt(searchPage, 1),
        size: toInt(searchSize, 10),
        sort: searchSort,
      });
      setSearchResult(result);
      setBanner(`Tìm được ${result.count} item trên trang ${result.pageNumber}.`);
    } catch (error) {
      setSearchError(friendlyApiError(error));
    } finally {
      setSearchLoading(false);
    }
  }

  async function executeTrack(url: string, nickname?: string): Promise<void> {
    const normalizedUrl = url.trim();
    if (!normalizedUrl) {
      setTrackError('Nhập Shopee URL trước khi track.');
      return;
    }

    setTrackLoading(true);
    setTrackError(null);
    setBanner(null);
    setTrackUrl(normalizedUrl);
    if (nickname !== undefined) setTrackNickname(nickname);

    try {
      const result = await trackProduct(config, {
        url: normalizedUrl,
        nickname: nickname?.trim() || undefined,
      });
      setTrackResult(result);
      setBanner(`Đã track ${result.productId} thành công.`);
      setActiveTab('track');
    } catch (error) {
      setTrackError(friendlyApiError(error));
    } finally {
      setTrackLoading(false);
    }
  }

  async function loadWatchlists(): Promise<void> {
    if (!config.userId.trim()) {
      setWatchlistError('Watchlists hiện tại cần X-User-Id. Hãy nhập user id trong Settings.');
      return;
    }

    setWatchlistLoading(true);
    setWatchlistError(null);
    setBanner(null);
    try {
      const result = await fetchWatchlists(config, {
        status: watchlistFilter,
        page: toInt(watchlistPage, 1),
        size: toInt(watchlistSize, 12),
      });
      setWatchlistResult(result);
      setBanner(`Đã tải ${result.items.length} watchlist.`);
    } catch (error) {
      setWatchlistError(friendlyApiError(error));
    } finally {
      setWatchlistLoading(false);
    }
  }

  async function toggleWatchlist(item: WatchlistItem): Promise<void> {
    setWatchlistLoading(true);
    setWatchlistError(null);
    try {
      await updateWatchlist(config, item.watchlistId, {
        status: item.status === 'paused' ? 'active' : 'paused',
      });
      await loadWatchlists();
    } catch (error) {
      setWatchlistError(friendlyApiError(error));
      setWatchlistLoading(false);
    }
  }

  function confirmRemoveWatchlist(item: WatchlistItem): void {
    Alert.alert('Delete watchlist?', `Mark ${item.name ?? item.productId} as deleted?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void removeWatchlist(item) },
    ]);
  }

  // FR-NOTIF-004: Enable mobile push — request permission + subscribe token.
  async function enableMobilePush(): Promise<void> {
    setPushLoading(true);
    try {
      const granted = await requestNotificationPermission();
      if (!granted) {
        setBanner('Notification permission denied.');
        setPushLoading(false);
        return;
      }

      const success = await subscribePushToken(
        config.apiBaseUrl,
        config.userId,
        config.bearerToken,
        '1.0.0', // appVersion placeholder
      );

      if (success) {
        setPushEnabled(true);
        setBanner('Mobile notifications enabled.');
      } else {
        setBanner('Failed to register push token.');
      }
    } catch (error) {
      setBanner('Error enabling mobile push.');
      console.error('[push] enableMobilePush error:', error);
    } finally {
      setPushLoading(false);
    }
  }

  async function disableMobilePush(): Promise<void> {
    setPushLoading(true);
    try {
      const success = await unsubscribePushToken(config.apiBaseUrl, config.userId, config.bearerToken);
      if (success) {
        setPushEnabled(false);
        setBanner('Mobile notifications disabled.');
      } else {
        setBanner('Failed to disable mobile push.');
      }
    } catch (error) {
      setBanner('Error disabling mobile push.');
      console.error('[push] disableMobilePush error:', error);
    } finally {
      setPushLoading(false);
    }
  }

  async function removeWatchlist(item: WatchlistItem): Promise<void> {
    setWatchlistLoading(true);
    setWatchlistError(null);
    try {
      await deleteWatchlist(config, item.watchlistId);
      await loadWatchlists();
    } catch (error) {
      setWatchlistError(friendlyApiError(error));
      setWatchlistLoading(false);
    }
  }

  async function openLink(url: string): Promise<void> {
    try {
      await Linking.openURL(url);
    } catch {
      setBanner('Không mở được link trên thiết bị này.');
    }
  }

  const connectionReady = Boolean(config.apiBaseUrl.trim()) && Boolean(config.userId.trim() || config.bearerToken.trim());
  const authStatus = config.bearerToken.trim() ? 'Bearer' : config.userId.trim() ? 'User ID' : 'Guest';
  const savedStatus = sessionReady ? 'On device' : 'Restoring';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style='dark' />
      <View style={styles.background}>
        <View style={styles.decorTop} />
        <View style={styles.decorBottom} />
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps='handled'>
          <Animated.View
            style={[
              styles.heroCard,
              {
                opacity: heroOpacity,
                transform: [{ translateY: heroOffset }],
              },
            ]}
          >
            <View style={styles.heroTopRow}>
              <View>
                <Text style={styles.kicker}>P3 mobile slice</Text>
                <Text style={styles.heroTitle}>SaleNoti Mobile</Text>
              </View>
              <View style={styles.versionPill}>
                <Text style={styles.versionPillText}>FR-WATCH-004</Text>
              </View>
            </View>
            <Text style={styles.heroCopy}>
              Search, track, and manage watchlists from a phone while reusing the Phase 1 API surfaces already shipped.
            </Text>
            <View style={styles.statsRow}>
              <StatPill label='API' value={connectionReady ? 'Ready' : 'Needs setup'} tone={connectionReady ? 'success' : 'warning'} />
              <StatPill label='Disclosure' value={DISCLOSURE_VERSION} tone='accent' />
              <StatPill label='Auth' value={authStatus} tone={connectionReady ? 'success' : 'warning'} />
              <StatPill label='Saved' value={savedStatus} tone={sessionReady ? 'success' : 'warning'} />
              <StatPill label='Tab' value={TABS.find((tab) => tab.key === activeTab)?.label ?? 'Search'} tone='ink' />
            </View>
          </Animated.View>

          {banner ? <Notice kind='success' text={banner} /> : null}
          {sessionNotice ? <Notice kind='info' text={sessionNotice} /> : null}

          <View style={styles.tabsCard}>
            <View style={styles.tabRow}>
              {TABS.map((tab) => {
                const selected = activeTab === tab.key;
                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => setActiveTab(tab.key)}
                    style={({ pressed }: { pressed: boolean }) => [
                      styles.tabButton,
                      selected && styles.tabButtonActive,
                      pressed && styles.tabButtonPressed,
                    ]}
                  >
                    <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>{tab.label}</Text>
                    <Text style={[styles.tabDescription, selected && styles.tabDescriptionActive]}>{tab.description}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {activeTab === 'search' ? (
            <SectionCard title='Product search' subtitle='GET /v1/products/search with cached backend results.'>
              <FieldLabel label='Keyword' hint='Search product catalog' />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder='ao thun basic'
                placeholderTextColor='rgba(18,33,43,0.4)'
                style={styles.input}
                id='mobile-search-query'
                name='searchQuery'
              />

              <View style={styles.rowGap}>
                <View style={styles.flexHalf}>
                  <FieldLabel label='Page' hint='1-50' />
                  <TextInput
                    value={searchPage}
                    onChangeText={setSearchPage}
                    keyboardType='number-pad'
                    style={styles.input}
                    placeholder='1'
                    placeholderTextColor='rgba(18,33,43,0.4)'
                    id='mobile-search-page'
                    name='searchPage'
                  />
                </View>
                <View style={styles.flexHalf}>
                  <FieldLabel label='Size' hint='1-20' />
                  <TextInput
                    value={searchSize}
                    onChangeText={setSearchSize}
                    keyboardType='number-pad'
                    style={styles.input}
                    placeholder='10'
                    placeholderTextColor='rgba(18,33,43,0.4)'
                    id='mobile-search-size'
                    name='searchSize'
                  />
                </View>
              </View>

              <View style={styles.sortRow}>
                {SEARCH_SORT_OPTIONS.map((option) => {
                  const selected = searchSort === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => setSearchSort(option.value)}
                      style={({ pressed }: { pressed: boolean }) => [styles.sortChip, selected && styles.sortChipActive, pressed && styles.sortChipPressed]}
                    >
                      <Text style={[styles.sortChipText, selected && styles.sortChipTextActive]}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <ActionButton label={searchLoading ? 'Searching...' : 'Search catalog'} onPress={loadSearch} disabled={searchLoading || !searchQuery.trim()} />

              {searchError ? <Notice kind='error' text={searchError} /> : null}

              {searchResult ? (
                <View style={styles.resultSummaryCard}>
                  <View style={styles.summaryRow}>
                    <StatPill label='Page results' value={String(searchResult.count)} tone='ink' />
                    <StatPill label='Cached' value={searchResult.cached ? 'Yes' : 'No'} tone={searchResult.cached ? 'success' : 'warning'} />
                  </View>
                  <Text style={styles.summaryText}>
                    Page {searchResult.pageNumber} of size {searchResult.pageSize} in {searchResult.sort}.
                  </Text>
                  <FlatList
                    data={searchResult.items}
                    keyExtractor={(item: SearchResult['items'][number]) => `${item.shopId}-${item.itemId}`}
                    scrollEnabled={false}
                    ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
                    renderItem={({ item }: { item: SearchResult['items'][number] }) => {
                      const productUrl = buildShopeeProductUrl(item.shopId, item.itemId);
                      return (
                        <ProductCard
                          imageUrl={item.imageUrl}
                          title={item.productName}
                          subtitle={`ID ${item.shopId}-${item.itemId}`}
                          price={item.currentPrice}
                          originalPrice={item.originalPrice}
                          sales={item.sales}
                          affiliateLinkUrl={item.affiliateLinkUrl}
                          onTrack={() => void executeTrack(productUrl, item.productName)}
                          onOpenAffiliate={item.affiliateLinkUrl ? () => void openLink(item.affiliateLinkUrl ?? productUrl) : undefined}
                          onOpenProduct={() => void openLink(productUrl)}
                        />
                      );
                    }}
                    ListEmptyComponent={<EmptyState title='No results yet' text='Tap Search to load results from the API.' />}
                  />
                </View>
              ) : (
                <EmptyState title='Search ready' text='Run a query to see cached results and affiliate enrichment.' />
              )}
            </SectionCard>
          ) : null}

          {activeTab === 'track' ? (
            <SectionCard title='Track a product' subtitle='POST /v1/products/track with manual URL or a product picked from search.'>
              <FieldLabel label='Shopee URL' hint='Paste product URL' />
              <TextInput
                value={trackUrl}
                onChangeText={setTrackUrl}
                placeholder='https://shopee.vn/product-i.123.456'
                placeholderTextColor='rgba(18,33,43,0.4)'
                style={styles.input}
                autoCapitalize='none'
                autoCorrect={false}
                id='mobile-track-url'
                name='trackUrl'
              />

              <FieldLabel label='Nickname' hint='Optional display label' />
              <TextInput
                value={trackNickname}
                onChangeText={setTrackNickname}
                placeholder='Ao thun basic'
                placeholderTextColor='rgba(18,33,43,0.4)'
                style={styles.input}
                id='mobile-track-nickname'
                name='trackNickname'
              />

              <ActionButton label={trackLoading ? 'Tracking...' : 'Track now'} onPress={() => void executeTrack(trackUrl, trackNickname)} disabled={trackLoading || !trackUrl.trim()} />

              <HelperText text='The backend accepts either Bearer token auth or X-User-Id for dev mode.' />

              {trackError ? <Notice kind='error' text={trackError} /> : null}

              {trackResult ? (
                <ResultCard
                  title={trackResult.name}
                  subtitle={trackResult.productId}
                  imageUrl={trackResult.imageUrl}
                  badges={[`Tracked ${trackResult.watchlistId}`, trackResult.is30DayLow ? '30d low' : 'normal', `${formatPercent(trackResult.discountPct)} off`]}
                  body={`Current ${formatVnd(trackResult.currentPrice)} | Original ${formatVnd(trackResult.originalPrice)} | 30d min ${formatVnd(trackResult.last30dMin)}`}
                  onPrimaryAction={() => void openLink(trackResult.affiliateLink)}
                  primaryLabel='Open affiliate link'
                  onSecondaryAction={() => void openLink(productUrlFromId(trackResult.productId))}
                  secondaryLabel='Open Shopee URL'
                />
              ) : (
                <EmptyState title='No tracked item yet' text='Track a product from Search or paste a Shopee URL here.' />
              )}
            </SectionCard>
          ) : null}

          {activeTab === 'watchlists' ? (
            <SectionCard title='Watchlists' subtitle='GET /v1/watchlists and update status or delete items.'>
              <FieldLabel label='Filter' hint='active / paused / all' />
              <View style={styles.sortRow}>
                {WATCHLIST_FILTER_OPTIONS.map((option) => {
                  const selected = watchlistFilter === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => setWatchlistFilter(option.value)}
                      style={({ pressed }: { pressed: boolean }) => [styles.sortChip, selected && styles.sortChipActive, pressed && styles.sortChipPressed]}
                    >
                      <Text style={[styles.sortChipText, selected && styles.sortChipTextActive]}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.rowGap}>
                <View style={styles.flexHalf}>
                  <FieldLabel label='Page' hint='1+' />
                  <TextInput
                    value={watchlistPage}
                    onChangeText={setWatchlistPage}
                    keyboardType='number-pad'
                    style={styles.input}
                    placeholder='1'
                    placeholderTextColor='rgba(18,33,43,0.4)'
                    id='mobile-watchlist-page'
                    name='watchlistPage'
                  />
                </View>
                <View style={styles.flexHalf}>
                  <FieldLabel label='Size' hint='1-50' />
                  <TextInput
                    value={watchlistSize}
                    onChangeText={setWatchlistSize}
                    keyboardType='number-pad'
                    style={styles.input}
                    placeholder='12'
                    placeholderTextColor='rgba(18,33,43,0.4)'
                    id='mobile-watchlist-size'
                    name='watchlistSize'
                  />
                </View>
              </View>

              <ActionButton label={watchlistLoading ? 'Refreshing...' : 'Refresh watchlists'} onPress={loadWatchlists} disabled={watchlistLoading} />

              {watchlistError ? <Notice kind='error' text={watchlistError} /> : null}

              {watchlistResult ? (
                <View style={styles.resultSummaryCard}>
                  <View style={styles.summaryRow}>
                    <StatPill label='Items' value={String(watchlistResult.items.length)} tone='ink' />
                    <StatPill label='Total' value={String(watchlistResult.total)} tone='accent' />
                  </View>
                  <Text style={styles.summaryText}>
                    Page {watchlistResult.page} with size {watchlistResult.size}.
                  </Text>
                  <FlatList
                    data={watchlistResult.items}
                    keyExtractor={(item: WatchlistItem) => item.watchlistId}
                    scrollEnabled={false}
                    ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
                    renderItem={({ item }: { item: WatchlistItem }) => (
                      <WatchlistCard
                        item={item}
                        onOpen={() => void openLink(productUrlFromId(item.productId))}
                        onToggle={() => void toggleWatchlist(item)}
                        onRemove={() => confirmRemoveWatchlist(item)}
                      />
                    )}
                    ListEmptyComponent={<EmptyState title='No watchlists' text='Use Track to create the first watchlist.' />}
                  />
                </View>
              ) : (
                <EmptyState title='Watchlists ready' text='The list loads as soon as you open this tab.' />
              )}
            </SectionCard>
          ) : null}

          {activeTab === 'settings' ? (
            <SectionCard title='Connection settings' subtitle='Tune API base URL, auth headers, and the session saved on this device.'>
              <WebFormBoundary>
                <FieldLabel label='API base URL' hint='localhost or LAN IP' />
                <TextInput
                  value={config.apiBaseUrl}
                  onChangeText={(value: string) => setConfig((current: MobileConfig) => ({ ...current, apiBaseUrl: normalizeApiBaseUrl(value) }))}
                  placeholder={defaultApiBaseUrl()}
                  placeholderTextColor='rgba(18,33,43,0.4)'
                  style={styles.input}
                  autoCapitalize='none'
                  autoCorrect={false}
                  id='mobile-api-base-url'
                  name='apiBaseUrl'
                />

                <FieldLabel label='User ID' hint='Required for watchlists CRUD' />
                <TextInput
                  value={config.userId}
                  onChangeText={(value: string) => setConfig((current: MobileConfig) => ({ ...current, userId: value }))}
                  placeholder='Mongo ObjectId or dev id'
                  placeholderTextColor='rgba(18,33,43,0.4)'
                  style={styles.input}
                  autoCapitalize='none'
                  autoCorrect={false}
                  id='mobile-user-id'
                  name='userId'
                />

                <FieldLabel label='Bearer token' hint='Optional for auth-backed search/track' />
                <TextInput
                  value={config.bearerToken}
                  onChangeText={(value: string) => setConfig((current: MobileConfig) => ({ ...current, bearerToken: value }))}
                  placeholder='Paste access token'
                  placeholderTextColor='rgba(18,33,43,0.4)'
                  style={styles.input}
                  autoCapitalize='none'
                  autoCorrect={false}
                  secureTextEntry
                  id='mobile-bearer-token'
                  name='bearerToken'
                />

                <View style={styles.rowGap}>
                  <View style={styles.flexHalf}>
                    <ActionButton label='Use local defaults' onPress={() => setConfig(createDefaultConfig())} />
                  </View>
                  <View style={styles.flexHalf}>
                    <ActionButton label='Forget this device' onPress={() => void clearPersistedSession()} variant='secondary' />
                  </View>
                </View>

                <View style={styles.rowGap}>
                  <View style={styles.flexHalf}>
                    <ActionButton
                      label={pushLoading ? 'Enabling...' : pushEnabled ? 'Disable push' : 'Enable mobile push'}
                      onPress={() => (pushEnabled ? void disableMobilePush() : void enableMobilePush())}
                      disabled={pushLoading}
                      variant={pushEnabled ? 'secondary' : 'primary'}
                    />
                  </View>
                  <View style={styles.flexHalf}>
                    <ActionButton label='Go to Search' onPress={() => setActiveTab('search')} variant='secondary' />
                  </View>
                </View>

                <HelperText text='Bearer token and the rest of the session are stored locally on this device. Clearing this device removes the saved auth snapshot. Mobile notifications require permission and your device token to be registered with the backend.' />

                <View style={styles.statusCard}>
                  <StatPill label='Base' value={normalizeApiBaseUrl(config.apiBaseUrl)} tone='ink' />
                  <StatPill label='Auth' value={authStatus} tone={config.bearerToken.trim() || config.userId.trim() ? 'success' : 'warning'} />
                  <StatPill label='Persist' value={sessionReady ? 'Synced' : 'Loading'} tone={sessionReady ? 'success' : 'warning'} />
                  <StatPill label='Push' value={pushEnabled ? 'Enabled' : 'Disabled'} tone={pushEnabled ? 'success' : 'warning'} />
                </View>

                <DisclosurePanel />
              </WebFormBoundary>
            </SectionCard>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function DisclosurePanel() {
  return (
    <View style={styles.disclosureCard}>
      <Text style={styles.sectionHeading}>Disclosure</Text>
      <Text style={styles.disclosureText}>{AFFILIATE_DISCLOSURE_VI}</Text>
      <View style={{ height: 12 }} />
      <Text style={styles.sectionHeading}>5 principles</Text>
      <View style={styles.principleList}>
        {FIVE_PRINCIPLES_VI.map((principle: (typeof FIVE_PRINCIPLES_VI)[number]) => (
          <View key={principle.id} style={styles.principleItem}>
            <View style={styles.principleBadge}>
              <Text style={styles.principleBadgeText}>{principle.id}</Text>
            </View>
            <View style={styles.principleBody}>
              <Text style={styles.principleTitle}>{principle.title}</Text>
              <Text style={styles.principleText}>{principle.body}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeading}>{title}</Text>
        <Text style={styles.sectionSubheading}>{subtitle}</Text>
      </View>
      <View style={{ height: 16 }} />
      {children}
    </View>
  );
}

function WebFormBoundary({ children }: { children: ReactNode }) {
  if (Platform.OS === 'web') {
    return (
      <form onSubmit={(event: any) => event.preventDefault()} style={{ display: 'contents' }}>
        {children}
      </form>
    );
  }

  return <>{children}</>;
}

function FieldLabel({ label, hint }: { label: string; hint: string }) {
  return (
    <View style={styles.fieldLabelRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldHint}>{hint}</Text>
    </View>
  );
}

function HelperText({ text }: { text: string }) {
  return <Text style={styles.helperText}>{text}</Text>;
}

function Notice({ kind, text }: { kind: 'success' | 'error' | 'info'; text: string }) {
  return (
    <View
      style={[
        styles.notice,
        kind === 'success' && styles.noticeSuccess,
        kind === 'error' && styles.noticeError,
        kind === 'info' && styles.noticeInfo,
      ]}
    >
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }: { pressed: boolean }) => [
        styles.actionButton,
        variant === 'primary' ? styles.actionButtonPrimary : styles.actionButtonSecondary,
        disabled && styles.actionButtonDisabled,
        pressed && !disabled && styles.actionButtonPressed,
      ]}
    >
      <Text style={[styles.actionButtonText, variant === 'secondary' && styles.actionButtonTextSecondary]}>{label}</Text>
    </Pressable>
  );
}

function StatPill({ label, value, tone }: { label: string; value: string; tone: 'ink' | 'success' | 'warning' | 'accent' }) {
  return (
    <View style={[styles.statPill, tone === 'success' && styles.statPillSuccess, tone === 'warning' && styles.statPillWarning, tone === 'accent' && styles.statPillAccent]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, tone === 'success' && styles.statValueSuccess, tone === 'warning' && styles.statValueWarning, tone === 'accent' && styles.statValueAccent]}>{value}</Text>
    </View>
  );
}

function ProductCard({
  imageUrl,
  title,
  subtitle,
  price,
  originalPrice,
  sales,
  affiliateLinkUrl,
  onTrack,
  onOpenAffiliate,
  onOpenProduct,
}: {
  imageUrl: string | null;
  title: string;
  subtitle: string;
  price: number;
  originalPrice: number;
  sales: number;
  affiliateLinkUrl: string | null;
  onTrack: () => void;
  onOpenAffiliate?: () => void;
  onOpenProduct: () => void;
}) {
  return (
    <View style={styles.itemCard}>
      <View style={styles.itemRow}>
        <View style={styles.itemImageWrap}>
          {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.itemImage} /> : <View style={styles.itemImageFallback}><Text style={styles.itemImageFallbackText}>SN</Text></View>}
        </View>
        <View style={styles.itemCopy}>
          <Text style={styles.itemTitle} numberOfLines={2}>{title}</Text>
          <Text style={styles.itemSubtitle}>{subtitle}</Text>
          <View style={styles.badgeRow}>
            <MiniBadge text={formatVnd(price)} tone='accent' />
            <MiniBadge text={`was ${formatVnd(originalPrice)}`} tone='neutral' />
            <MiniBadge text={`${sales.toLocaleString('vi-VN')} sales`} tone='neutral' />
          </View>
          {affiliateLinkUrl ? <MiniBadge text='Affiliate link ready' tone='success' /> : null}
        </View>
      </View>
      <View style={styles.cardActions}>
        <ActionButton label='Track now' onPress={onTrack} />
        <ActionButton label='Open product' onPress={onOpenProduct} variant='secondary' />
        {onOpenAffiliate ? <ActionButton label='Open affiliate' onPress={onOpenAffiliate} variant='secondary' /> : null}
      </View>
    </View>
  );
}

function ResultCard({
  title,
  subtitle,
  imageUrl,
  badges,
  body,
  onPrimaryAction,
  primaryLabel,
  onSecondaryAction,
  secondaryLabel,
}: {
  title: string;
  subtitle: string;
  imageUrl: string | null;
  badges: string[];
  body: string;
  onPrimaryAction: () => void;
  primaryLabel: string;
  onSecondaryAction: () => void;
  secondaryLabel: string;
}) {
  return (
    <View style={styles.resultCard}>
      <View style={styles.itemRow}>
        <View style={styles.itemImageWrap}>
          {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.itemImage} /> : <View style={styles.itemImageFallback}><Text style={styles.itemImageFallbackText}>SN</Text></View>}
        </View>
        <View style={styles.itemCopy}>
          <Text style={styles.itemTitle} numberOfLines={2}>{title}</Text>
          <Text style={styles.itemSubtitle}>{subtitle}</Text>
          <View style={styles.badgeRow}>
            {badges.map((badge) => (
              <MiniBadge text={badge} tone='neutral' />
            ))}
          </View>
          <Text style={styles.resultBody}>{body}</Text>
        </View>
      </View>
      <View style={styles.cardActions}>
        <ActionButton label={primaryLabel} onPress={onPrimaryAction} />
        <ActionButton label={secondaryLabel} onPress={onSecondaryAction} variant='secondary' />
      </View>
    </View>
  );
}

function WatchlistCard({
  item,
  onOpen,
  onToggle,
  onRemove,
}: {
  item: WatchlistItem;
  onOpen: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const isDeleted = item.status === 'deleted';
  const statusTone: 'neutral' | 'accent' | 'success' | 'warning' =
    item.status === 'active' ? 'success' : item.status === 'paused' ? 'warning' : 'neutral';
  return (
    <View style={styles.itemCard}>
      <View style={styles.itemRow}>
        <View style={styles.itemImageWrap}>
          {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.itemImage} /> : <View style={styles.itemImageFallback}><Text style={styles.itemImageFallbackText}>WL</Text></View>}
        </View>
        <View style={styles.itemCopy}>
          <Text style={styles.itemTitle} numberOfLines={2}>{item.name ?? shortProductLabel(item.productId)}</Text>
          <Text style={styles.itemSubtitle}>{item.productId}</Text>
          <View style={styles.badgeRow}>
            <MiniBadge text={item.status} tone={statusTone} />
            <MiniBadge text={formatVnd(item.currentPrice)} tone='accent' />
            <MiniBadge text={`${formatPercent(item.currentDiscountPct)} off`} tone='neutral' />
            <MiniBadge text={`30d min ${formatVnd(item.last30dMin)}`} tone='neutral' />
          </View>
          <Text style={styles.resultBody}>Updated {formatDate(item.updatedAt)} | Track baseline {formatVnd(item.baselineAtTrack)}</Text>
        </View>
      </View>
      <View style={styles.cardActions}>
        <ActionButton label='Open' onPress={onOpen} />
        {!isDeleted ? <ActionButton label={item.status === 'paused' ? 'Resume' : 'Pause'} onPress={onToggle} variant='secondary' /> : null}
        {!isDeleted ? <ActionButton label='Delete' onPress={onRemove} variant='secondary' /> : null}
      </View>
    </View>
  );
}

function MiniBadge({ text, tone }: { text: string; tone: 'neutral' | 'accent' | 'success' | 'warning' }) {
  return (
    <View style={[styles.miniBadge, tone === 'accent' && styles.miniBadgeAccent, tone === 'success' && styles.miniBadgeSuccess, tone === 'warning' && styles.miniBadgeWarning]}>
      <Text style={[styles.miniBadgeText, tone === 'accent' && styles.miniBadgeTextAccent, tone === 'success' && styles.miniBadgeTextSuccess, tone === 'warning' && styles.miniBadgeTextWarning]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  background: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 48,
    gap: 16,
  },
  decorTop: {
    position: 'absolute',
    top: -30,
    right: -20,
    width: 190,
    height: 190,
    borderRadius: 190,
    backgroundColor: 'rgba(15, 118, 110, 0.12)',
  },
  decorBottom: {
    position: 'absolute',
    bottom: 90,
    left: -60,
    width: 220,
    height: 220,
    borderRadius: 220,
    backgroundColor: 'rgba(217, 119, 87, 0.10)',
  },
  heroCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 20,
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  kicker: {
    color: COLORS.accent,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    fontSize: 12,
    fontWeight: '700',
  },
  heroTitle: {
    marginTop: 6,
    color: COLORS.ink,
    fontFamily: HIGHLIGHT_FONT,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '700',
  },
  heroCopy: {
    marginTop: 12,
    color: COLORS.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  versionPill: {
    borderRadius: 999,
    backgroundColor: COLORS.accentSoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  versionPillText: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  statsRow: {
    marginTop: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statPill: {
    minWidth: 94,
    flexGrow: 1,
    flexBasis: 0,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.surfaceAlt,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  statPillSuccess: {
    backgroundColor: 'rgba(22, 101, 52, 0.10)',
    borderColor: 'rgba(22, 101, 52, 0.18)',
  },
  statPillWarning: {
    backgroundColor: 'rgba(154, 52, 18, 0.10)',
    borderColor: 'rgba(154, 52, 18, 0.18)',
  },
  statPillAccent: {
    backgroundColor: 'rgba(15, 118, 110, 0.10)',
    borderColor: 'rgba(15, 118, 110, 0.18)',
  },
  statLabel: {
    color: COLORS.muted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  statValue: {
    color: COLORS.ink,
    marginTop: 4,
    fontSize: 14,
    fontWeight: '800',
  },
  statValueSuccess: { color: COLORS.success },
  statValueWarning: { color: COLORS.warning },
  statValueAccent: { color: COLORS.accent },
  tabsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 10,
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.04,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  tabButton: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: '22%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: COLORS.surfaceAlt,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonActive: {
    backgroundColor: COLORS.ink,
  },
  tabButtonPressed: {
    transform: [{ scale: 0.99 }],
  },
  tabLabel: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  tabLabelActive: {
    color: '#FFFFFF',
  },
  tabDescription: {
    marginTop: 3,
    color: COLORS.muted,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '700',
  },
  tabDescriptionActive: {
    color: 'rgba(255,255,255,0.76)',
  },
  sectionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 18,
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.04,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  sectionHeader: {
    gap: 6,
  },
  sectionHeading: {
    color: COLORS.ink,
    fontSize: 20,
    fontWeight: '800',
    fontFamily: HIGHLIGHT_FONT,
  },
  sectionSubheading: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
    marginTop: 12,
  },
  fieldLabel: {
    color: COLORS.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  fieldHint: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.surfaceAlt,
    color: COLORS.ink,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
  },
  rowGap: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  flexHalf: {
    flex: 1,
  },
  sortRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  sortChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sortChipActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  sortChipPressed: {
    transform: [{ scale: 0.98 }],
  },
  sortChipText: {
    color: COLORS.ink,
    fontSize: 12,
    fontWeight: '800',
  },
  sortChipTextActive: {
    color: '#FFFFFF',
  },
  actionButton: {
    borderRadius: 18,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  actionButtonPrimary: {
    backgroundColor: COLORS.ink,
  },
  actionButtonSecondary: {
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  actionButtonDisabled: {
    opacity: 0.55,
  },
  actionButtonPressed: {
    transform: [{ scale: 0.99 }],
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  actionButtonTextSecondary: {
    color: COLORS.ink,
  },
  helperText: {
    marginTop: 10,
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  notice: {
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  noticeSuccess: {
    backgroundColor: 'rgba(22, 101, 52, 0.10)',
    borderColor: 'rgba(22, 101, 52, 0.22)',
  },
  noticeError: {
    backgroundColor: 'rgba(180, 35, 24, 0.10)',
    borderColor: 'rgba(180, 35, 24, 0.22)',
  },
  noticeInfo: {
    backgroundColor: 'rgba(15, 118, 110, 0.10)',
    borderColor: 'rgba(15, 118, 110, 0.22)',
  },
  noticeText: {
    color: COLORS.ink,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  resultSummaryCard: {
    marginTop: 16,
    borderRadius: 24,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 14,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  summaryText: {
    marginTop: 10,
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  itemCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.card,
    padding: 14,
  },
  resultCard: {
    marginTop: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.surface,
    padding: 14,
  },
  itemRow: {
    flexDirection: 'row',
    gap: 12,
  },
  itemImageWrap: {
    width: 84,
    height: 84,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceAlt,
  },
  itemImage: {
    width: '100%',
    height: '100%',
  },
  itemImageFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accentSoft,
  },
  itemImageFallbackText: {
    color: COLORS.accent,
    fontSize: 18,
    fontWeight: '900',
  },
  itemCopy: {
    flex: 1,
    minWidth: 0,
  },
  itemTitle: {
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 21,
  },
  itemSubtitle: {
    marginTop: 4,
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  miniBadge: {
    borderRadius: 999,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.line,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  miniBadgeAccent: {
    backgroundColor: COLORS.accentSoft,
    borderColor: 'rgba(15, 118, 110, 0.2)',
  },
  miniBadgeSuccess: {
    backgroundColor: 'rgba(22, 101, 52, 0.10)',
    borderColor: 'rgba(22, 101, 52, 0.18)',
  },
  miniBadgeWarning: {
    backgroundColor: 'rgba(154, 52, 18, 0.10)',
    borderColor: 'rgba(154, 52, 18, 0.18)',
  },
  miniBadgeText: {
    color: COLORS.ink,
    fontSize: 11,
    fontWeight: '700',
  },
  miniBadgeTextAccent: {
    color: COLORS.accent,
  },
  miniBadgeTextSuccess: {
    color: COLORS.success,
  },
  miniBadgeTextWarning: {
    color: COLORS.warning,
  },
  resultBody: {
    marginTop: 10,
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  cardActions: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  disclosureCard: {
    marginTop: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.surfaceAlt,
    padding: 16,
  },
  disclosureText: {
    marginTop: 8,
    color: COLORS.ink,
    fontSize: 13,
    lineHeight: 20,
  },
  principleList: {
    marginTop: 6,
    gap: 10,
  },
  principleItem: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  principleBadge: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.ink,
  },
  principleBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  principleBody: {
    flex: 1,
  },
  principleTitle: {
    color: COLORS.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  principleText: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  emptyState: {
    marginTop: 16,
    paddingVertical: 18,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.surfaceAlt,
  },
  emptyTitle: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  emptyText: {
    marginTop: 6,
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  statusCard: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
});
