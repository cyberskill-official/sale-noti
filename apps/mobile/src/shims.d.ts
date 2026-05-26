declare module "react" {
  export type ReactNode = any;
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useRef<T>(initialValue: T): { current: T };
  export function useState<T>(initialState: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void];
}

declare module "react/jsx-runtime" {
  export const Fragment: any;
  export const jsx: any;
  export const jsxs: any;
}

declare module "react-native" {
  export const Alert: any;
  export const Animated: any;
  export const FlatList: any;
  export const Image: any;
  export const Linking: any;
  export const Platform: {
    OS: string;
    select<T>(options: { ios?: T; android?: T; default?: T }): T;
  };
  export const Pressable: any;
  export const SafeAreaView: any;
  export const ScrollView: any;
  export const StyleSheet: { create<T extends Record<string, unknown>>(styles: T): T };
  export const Text: any;
  export const TextInput: any;
  export const View: any;
}

declare module "expo-status-bar" {
  export const StatusBar: any;
}

declare module "expo-secure-store" {
  export function getItemAsync(key: string): Promise<string | null>;
  export function setItemAsync(key: string, value: string): Promise<void>;
  export function deleteItemAsync(key: string): Promise<void>;
}

declare module "@salenoti/disclosure-copy" {
  export const DISCLOSURE_VERSION: string;
  export const AFFILIATE_DISCLOSURE_VI: string;
  export const FIVE_PRINCIPLES_VI: readonly {
    id: number;
    title: string;
    body: string;
  }[];
}

declare namespace JSX {
  interface IntrinsicAttributes {
    key?: any;
  }

  interface IntrinsicElements {
    [elemName: string]: any;
  }
}
