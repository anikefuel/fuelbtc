// Country registry — global expansion architecture
// In production, this data lives in the database; this seeds/fallback layer

export interface CountryDefinition {
  code: string;       // ISO 3166-1 alpha-2  e.g. "NG"
  name: string;
  flag: string;       // emoji flag
  currency: string;   // ISO 4217 fiat code
  callingCode: string;
  isActive: boolean;
  isKycSupported: boolean;
  isP2PSupported: boolean;
  isSanctioned: boolean; // blocked by OFAC / compliance
  bankingProvider?: string; // e.g. "9PSB"
  paymentProviders: string[];
  kycDocuments: string[]; // accepted KYC document types
  kycProvider?: string;  // e.g. "smile_id", "jumio"
  disputeWindowHours: number;
  merchantRequirements: string[];
  languages: string[];
  timezone: string;
}

export const COUNTRY_REGISTRY: Record<string, CountryDefinition> = {
  NG: {
    code: 'NG', name: 'Nigeria', flag: '🇳🇬', currency: 'NGN', callingCode: '+234',
    isActive: true, isKycSupported: true, isP2PSupported: true, isSanctioned: false,
    bankingProvider: '9PSB',
    paymentProviders: ['9PSB', 'Opay', 'Palmpay', 'Flutterwave', 'Paystack'],
    kycDocuments: ['NIN', 'International Passport', "Driver's License", "Voter's Card"],
    kycProvider: 'smile_id',
    disputeWindowHours: 48,
    merchantRequirements: ['KYC Tier 2', 'BVN Verification'],
    languages: ['en'],
    timezone: 'Africa/Lagos',
  },
  US: {
    code: 'US', name: 'United States', flag: '🇺🇸', currency: 'USD', callingCode: '+1',
    isActive: false, isKycSupported: false, isP2PSupported: false, isSanctioned: false,
    paymentProviders: [],
    kycDocuments: ['SSN', 'Passport', "Driver's License"],
    kycProvider: undefined,
    disputeWindowHours: 72,
    merchantRequirements: ['MSB License'],
    languages: ['en'],
    timezone: 'America/New_York',
  },
  GB: {
    code: 'GB', name: 'United Kingdom', flag: '🇬🇧', currency: 'GBP', callingCode: '+44',
    isActive: false, isKycSupported: false, isP2PSupported: false, isSanctioned: false,
    paymentProviders: ['Faster Payments'],
    kycDocuments: ['Passport', "Driver's License"],
    kycProvider: undefined,
    disputeWindowHours: 48,
    merchantRequirements: ['FCA Compliance'],
    languages: ['en'],
    timezone: 'Europe/London',
  },
  GH: {
    code: 'GH', name: 'Ghana', flag: '🇬🇭', currency: 'GHS', callingCode: '+233',
    isActive: false, isKycSupported: false, isP2PSupported: false, isSanctioned: false,
    paymentProviders: ['MTN Mobile Money', 'Vodafone Cash'],
    kycDocuments: ['Ghana Card', 'Passport', "Driver's License"],
    kycProvider: 'smile_id',
    disputeWindowHours: 48,
    merchantRequirements: ['KYC Tier 2'],
    languages: ['en'],
    timezone: 'Africa/Accra',
  },
  KE: {
    code: 'KE', name: 'Kenya', flag: '🇰🇪', currency: 'KES', callingCode: '+254',
    isActive: false, isKycSupported: false, isP2PSupported: false, isSanctioned: false,
    paymentProviders: ['M-Pesa', 'Airtel Money'],
    kycDocuments: ['National ID', 'Passport'],
    kycProvider: 'smile_id',
    disputeWindowHours: 48,
    merchantRequirements: ['KYC Tier 2'],
    languages: ['en', 'sw'],
    timezone: 'Africa/Nairobi',
  },
  ZA: {
    code: 'ZA', name: 'South Africa', flag: '🇿🇦', currency: 'ZAR', callingCode: '+27',
    isActive: false, isKycSupported: false, isP2PSupported: false, isSanctioned: false,
    paymentProviders: ['EFT', 'Capitec Pay'],
    kycDocuments: ['SA ID', 'Passport'],
    kycProvider: undefined,
    disputeWindowHours: 48,
    merchantRequirements: ['KYC Tier 2', 'FICA'],
    languages: ['en', 'af', 'zu'],
    timezone: 'Africa/Johannesburg',
  },
  AE: {
    code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪', currency: 'AED', callingCode: '+971',
    isActive: false, isKycSupported: false, isP2PSupported: false, isSanctioned: false,
    paymentProviders: ['Bank Transfer'],
    kycDocuments: ['Emirates ID', 'Passport'],
    kycProvider: undefined,
    disputeWindowHours: 72,
    merchantRequirements: ['KYC Tier 3'],
    languages: ['ar', 'en'],
    timezone: 'Asia/Dubai',
  },
  IN: {
    code: 'IN', name: 'India', flag: '🇮🇳', currency: 'INR', callingCode: '+91',
    isActive: false, isKycSupported: false, isP2PSupported: false, isSanctioned: false,
    paymentProviders: ['UPI', 'IMPS', 'NEFT'],
    kycDocuments: ['Aadhaar', 'PAN Card', 'Passport'],
    kycProvider: undefined,
    disputeWindowHours: 48,
    merchantRequirements: ['PAN Verification'],
    languages: ['en', 'hi'],
    timezone: 'Asia/Kolkata',
  },
};

// Sanctioned countries — auto-rejected at registration
export const SANCTIONED_COUNTRY_CODES: string[] = [
  'IR', 'KP', 'CU', 'SY', 'BY', 'MM', 'SD', 'SO',
];

export const getActiveCountries = (): CountryDefinition[] =>
  Object.values(COUNTRY_REGISTRY).filter(c => c.isActive && !c.isSanctioned);

export const getCountry = (code: string): CountryDefinition | undefined =>
  COUNTRY_REGISTRY[code.toUpperCase()];

export const isCountrySanctioned = (code: string): boolean =>
  SANCTIONED_COUNTRY_CODES.includes(code.toUpperCase());
