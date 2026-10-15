/**
 * Default currency master data used to seed the `Currency` collection.
 * This is only a seed: the live list is read from the database and admins
 * can activate / deactivate currencies at runtime.
 */
export interface CurrencySeed {
  code: string;
  name: string;
  symbol: string;
  minorUnit: number;
  region: 'EUROPE' | 'NORTH_AMERICA' | 'SOUTH_AMERICA' | 'ASIA' | 'MIDDLE_EAST' | 'OCEANIA' | 'AFRICA';
  isPopular?: boolean;
}

export const CURRENCY_SEED: CurrencySeed[] = [
  // Europe
  { code: 'EUR', name: 'Euro', symbol: '€', minorUnit: 2, region: 'EUROPE', isPopular: true },
  { code: 'GBP', name: 'Pound Sterling', symbol: '£', minorUnit: 2, region: 'EUROPE', isPopular: true },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', minorUnit: 2, region: 'EUROPE', isPopular: true },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', minorUnit: 2, region: 'EUROPE' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', minorUnit: 2, region: 'EUROPE' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr', minorUnit: 2, region: 'EUROPE' },
  { code: 'PLN', name: 'Polish Złoty', symbol: 'zł', minorUnit: 2, region: 'EUROPE' },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč', minorUnit: 2, region: 'EUROPE' },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft', minorUnit: 2, region: 'EUROPE' },
  { code: 'RON', name: 'Romanian Leu', symbol: 'lei', minorUnit: 2, region: 'EUROPE' },
  { code: 'BGN', name: 'Bulgarian Lev', symbol: 'лв', minorUnit: 2, region: 'EUROPE' },
  { code: 'ISK', name: 'Icelandic Króna', symbol: 'kr', minorUnit: 0, region: 'EUROPE' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', minorUnit: 2, region: 'EUROPE' },
  // North America
  { code: 'USD', name: 'US Dollar', symbol: '$', minorUnit: 2, region: 'NORTH_AMERICA', isPopular: true },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', minorUnit: 2, region: 'NORTH_AMERICA', isPopular: true },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$', minorUnit: 2, region: 'NORTH_AMERICA' },
  // South America
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', minorUnit: 2, region: 'SOUTH_AMERICA' },
  { code: 'ARS', name: 'Argentine Peso', symbol: 'AR$', minorUnit: 2, region: 'SOUTH_AMERICA' },
  { code: 'CLP', name: 'Chilean Peso', symbol: 'CLP$', minorUnit: 0, region: 'SOUTH_AMERICA' },
  { code: 'COP', name: 'Colombian Peso', symbol: 'COL$', minorUnit: 2, region: 'SOUTH_AMERICA' },
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', minorUnit: 2, region: 'SOUTH_AMERICA' },
  // Asia
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', minorUnit: 0, region: 'ASIA', isPopular: true },
  { code: 'CNY', name: 'Chinese Yuan', symbol: 'CN¥', minorUnit: 2, region: 'ASIA' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', minorUnit: 2, region: 'ASIA', isPopular: true },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', minorUnit: 2, region: 'ASIA', isPopular: true },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', minorUnit: 0, region: 'ASIA' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', minorUnit: 2, region: 'ASIA' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', minorUnit: 2, region: 'ASIA' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', minorUnit: 2, region: 'ASIA' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', minorUnit: 2, region: 'ASIA' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', minorUnit: 2, region: 'ASIA' },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫', minorUnit: 0, region: 'ASIA' },
  { code: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$', minorUnit: 2, region: 'ASIA' },
  // Middle East
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED', minorUnit: 2, region: 'MIDDLE_EAST', isPopular: true },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', minorUnit: 2, region: 'MIDDLE_EAST' },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'QAR', minorUnit: 2, region: 'MIDDLE_EAST' },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KWD', minorUnit: 3, region: 'MIDDLE_EAST' },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: 'BHD', minorUnit: 3, region: 'MIDDLE_EAST' },
  { code: 'OMR', name: 'Omani Rial', symbol: 'OMR', minorUnit: 3, region: 'MIDDLE_EAST' },
  { code: 'ILS', name: 'Israeli New Shekel', symbol: '₪', minorUnit: 2, region: 'MIDDLE_EAST' },
  // Oceania
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', minorUnit: 2, region: 'OCEANIA', isPopular: true },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', minorUnit: 2, region: 'OCEANIA' },
  // Africa / international support
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', minorUnit: 2, region: 'AFRICA' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£', minorUnit: 2, region: 'AFRICA' },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: 'MAD', minorUnit: 2, region: 'AFRICA' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', minorUnit: 2, region: 'AFRICA' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵', minorUnit: 2, region: 'AFRICA' },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', minorUnit: 2, region: 'AFRICA' },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', minorUnit: 0, region: 'AFRICA' },
  { code: 'XOF', name: 'West African CFA Franc', symbol: 'CFA', minorUnit: 0, region: 'AFRICA' },
  { code: 'XAF', name: 'Central African CFA Franc', symbol: 'FCFA', minorUnit: 0, region: 'AFRICA' },
];
