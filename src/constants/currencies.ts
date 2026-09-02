// Fiat currency registry — global expansion ready

export interface FiatCurrency {
  code: string;           // ISO 4217  e.g. "NGN"
  name: string;           // e.g. "Nigerian Naira"
  symbol: string;         // e.g. "₦"
  flag: string;           // emoji flag
  decimalPlaces: number;
  isActive: boolean;
  isP2PSupported: boolean;
  p2pPaymentMethods: string[];
  minP2POrder: number;
  maxP2POrder: number;
}

export const FIAT_CURRENCIES: Record<string, FiatCurrency> = {
  NGN: {
    code: 'NGN', name: 'Nigerian Naira', symbol: '₦', flag: '🇳🇬',
    decimalPlaces: 2, isActive: true, isP2PSupported: true,
    p2pPaymentMethods: ['Bank Transfer', 'Opay', 'Palmpay', 'Kuda', 'Moniepoint', 'GTBank', 'Access Bank'],
    minP2POrder: 1000, maxP2POrder: 10_000_000,
  },
  USD: {
    code: 'USD', name: 'US Dollar', symbol: '$', flag: '🇺🇸',
    decimalPlaces: 2, isActive: true, isP2PSupported: false,
    p2pPaymentMethods: [],
    minP2POrder: 10, maxP2POrder: 100_000,
  },
  EUR: {
    code: 'EUR', name: 'Euro', symbol: '€', flag: '🇪🇺',
    decimalPlaces: 2, isActive: true, isP2PSupported: false,
    p2pPaymentMethods: [],
    minP2POrder: 10, maxP2POrder: 100_000,
  },
  GBP: {
    code: 'GBP', name: 'British Pound', symbol: '£', flag: '🇬🇧',
    decimalPlaces: 2, isActive: true, isP2PSupported: false,
    p2pPaymentMethods: [],
    minP2POrder: 10, maxP2POrder: 100_000,
  },
  KES: {
    code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', flag: '🇰🇪',
    decimalPlaces: 2, isActive: false, isP2PSupported: false,
    p2pPaymentMethods: ['M-Pesa', 'Bank Transfer'],
    minP2POrder: 500, maxP2POrder: 5_000_000,
  },
  GHS: {
    code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵', flag: '🇬🇭',
    decimalPlaces: 2, isActive: false, isP2PSupported: false,
    p2pPaymentMethods: ['Bank Transfer', 'MTN Mobile Money'],
    minP2POrder: 50, maxP2POrder: 500_000,
  },
  ZAR: {
    code: 'ZAR', name: 'South African Rand', symbol: 'R', flag: '🇿🇦',
    decimalPlaces: 2, isActive: false, isP2PSupported: false,
    p2pPaymentMethods: ['Bank Transfer', 'EFT'],
    minP2POrder: 100, maxP2POrder: 1_000_000,
  },
  AED: {
    code: 'AED', name: 'UAE Dirham', symbol: 'AED', flag: '🇦🇪',
    decimalPlaces: 2, isActive: false, isP2PSupported: false,
    p2pPaymentMethods: ['Bank Transfer'],
    minP2POrder: 50, maxP2POrder: 500_000,
  },
  INR: {
    code: 'INR', name: 'Indian Rupee', symbol: '₹', flag: '🇮🇳',
    decimalPlaces: 2, isActive: false, isP2PSupported: false,
    p2pPaymentMethods: ['UPI', 'IMPS', 'Bank Transfer'],
    minP2POrder: 500, maxP2POrder: 10_000_000,
  },
  PKR: {
    code: 'PKR', name: 'Pakistani Rupee', symbol: '₨', flag: '🇵🇰',
    decimalPlaces: 2, isActive: false, isP2PSupported: false,
    p2pPaymentMethods: ['Bank Transfer', 'JazzCash', 'Easypaisa'],
    minP2POrder: 1000, maxP2POrder: 10_000_000,
  },
  IDR: {
    code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', flag: '🇮🇩',
    decimalPlaces: 0, isActive: false, isP2PSupported: false,
    p2pPaymentMethods: ['Bank Transfer', 'GoPay', 'OVO'],
    minP2POrder: 50_000, maxP2POrder: 500_000_000,
  },
  MYR: {
    code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', flag: '🇲🇾',
    decimalPlaces: 2, isActive: false, isP2PSupported: false,
    p2pPaymentMethods: ['Bank Transfer', 'DuitNow'],
    minP2POrder: 50, maxP2POrder: 500_000,
  },
};

export const getActiveCurrencies = (): FiatCurrency[] =>
  Object.values(FIAT_CURRENCIES).filter(c => c.isActive);

export const getP2PSupportedCurrencies = (): FiatCurrency[] =>
  Object.values(FIAT_CURRENCIES).filter(c => c.isActive && c.isP2PSupported);

export const formatFiatAmount = (amount: number, code: string): string => {
  const currency = FIAT_CURRENCIES[code];
  if (!currency) return `${amount} ${code}`;
  return `${currency.symbol}${amount.toLocaleString('en-US', {
    minimumFractionDigits: currency.decimalPlaces,
    maximumFractionDigits: currency.decimalPlaces,
  })}`;
};
