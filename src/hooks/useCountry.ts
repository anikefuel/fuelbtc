// useCountry — active country / currency selection

import { useState, useMemo } from 'react';
import {
  COUNTRY_REGISTRY,
  FIAT_CURRENCIES,
  getActiveCurrencies,
  getP2PSupportedCurrencies,
  type CountryDefinition,
  type FiatCurrency,
} from '@/constants';

interface UseCountryResult {
  activeCountry: CountryDefinition;
  activeCurrency: FiatCurrency;
  setCountryCode: (code: string) => void;
  setCurrencyCode: (code: string) => void;
  allCurrencies: FiatCurrency[];
  p2pCurrencies: FiatCurrency[];
}

export function useCountry(
  initialCountryCode = 'NG',
  initialCurrencyCode = 'NGN',
): UseCountryResult {
  const [countryCode, setCountryCode] = useState(initialCountryCode);
  const [currencyCode, setCurrencyCode] = useState(initialCurrencyCode);

  const activeCountry = useMemo(
    () => COUNTRY_REGISTRY[countryCode] ?? COUNTRY_REGISTRY['NG'],
    [countryCode],
  );

  const activeCurrency = useMemo(
    () => FIAT_CURRENCIES[currencyCode] ?? FIAT_CURRENCIES['NGN'],
    [currencyCode],
  );

  return {
    activeCountry,
    activeCurrency,
    setCountryCode,
    setCurrencyCode,
    allCurrencies: getActiveCurrencies(),
    p2pCurrencies: getP2PSupportedCurrencies(),
  };
}
