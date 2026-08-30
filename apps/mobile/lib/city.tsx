import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

const CITY_KEY = 'opd.city';

type CityState = {
  /** null once loaded and nothing is stored - the first-run case. */
  city: string | null;
  setCity: (city: string) => Promise<void>;
  /** false until the stored value has been read; screens must not decide before this. */
  ready: boolean;
};

const CityContext = createContext<CityState | null>(null);

/**
 * The city the patient is browsing, remembered between launches.
 *
 * A DISPLAY FILTER, never an authority. docs/Rules.md 1 keeps the backend the only
 * source of truth: this value is passed as `?city=` and the server does the
 * filtering, exactly as it does for a caller who has never opened the app before.
 * Nothing about queue state, prices or permissions is decided here.
 *
 * ponytail: stored in expo-secure-store because it is already a dependency (it holds
 * the auth tokens). A city is not a secret and AsyncStorage would be the idiomatic
 * home, but that package is not in the workspace at all - SecureStore is a key-value
 * store that happens to encrypt, and this is one short string. Swap if a second,
 * larger preference ever appears.
 */
export function CityProvider({ children }: { children: React.ReactNode }) {
  const [city, setCityState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      // A read failure here is not worth breaking the app over: the user simply gets
      // the first-run city picker, which is a recoverable state rather than an error.
      const stored = await SecureStore.getItemAsync(CITY_KEY).catch(() => null);
      setCityState(stored);
      setReady(true);
    })();
  }, []);

  const setCity = useCallback(async (next: string) => {
    setCityState(next);
    await SecureStore.setItemAsync(CITY_KEY, next);
  }, []);

  const value = useMemo<CityState>(() => ({ city, setCity, ready }), [city, setCity, ready]);

  return <CityContext.Provider value={value}>{children}</CityContext.Provider>;
}

export function useCity(): CityState {
  const ctx = useContext(CityContext);
  if (!ctx) throw new Error('useCity must be used inside <CityProvider>');
  return ctx;
}
