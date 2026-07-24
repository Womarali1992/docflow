// Document folders
export const DOCUMENT_FOLDERS = {
  REPORTS: 'Reports',
  STATEMENTS: 'Statements',
  CONTRACTS: 'Contracts',
  DOCUMENTS: 'Documents',
} as const;

// Document types
export const DOCUMENT_TYPES = [
  'Bank Statement',
  'Tax Return',
  'ID Copy',
  'Pay Stub',
  'Investment Statement',
  'Insurance Policy',
  'W-2',
  '1099',
  'Mortgage Statement',
  'Business Financials',
] as const;

// Status colors and styles
export const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  reviewed: 'bg-green-100 text-green-800 border-green-200',
  needs_update: 'bg-red-100 text-red-800 border-red-200',
  fulfilled: 'bg-blue-100 text-blue-800 border-blue-200',
} as const;

// Frequency colors and styles
export const FREQUENCY_COLORS = {
  daily: 'bg-orange-50 border-orange-200 text-orange-800',
  monthly: 'bg-blue-50 border-blue-200 text-blue-800',
  quarterly: 'bg-purple-50 border-purple-200 text-purple-800',
  yearly: 'bg-green-50 border-green-200 text-green-800',
  'one-time': 'bg-gray-50 border-gray-200 text-gray-800',
} as const;

// Local storage keys
export const STORAGE_KEYS = {
  DOCUMENT_PRESETS: 'wlp.documentPresets',
} as const;

// Time constants
export const TIME_RANGES = {
  YEAR_RANGE_PAST: 5,
  YEAR_RANGE_FUTURE: 5,
} as const;

// UI constants
export const UI_LIMITS = {
  MAX_DISPLAYED_PERIODS: 6,
  MESSAGE_HISTORY_HEIGHT: '70vh',
  MESSAGE_HISTORY_HEIGHT_MD: '96',
} as const;

// Default advisor name (would typically come from auth context)
export const DEFAULT_ADVISOR_NAME = 'John Smith';
