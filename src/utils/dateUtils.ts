import { RequestFrequency } from '@/types/dashboard';
import { TIME_RANGES } from '@/constants/app';

/**
 * Format date for display
 */
export const formatDate = (date: Date): string => {
  return date.toLocaleDateString();
};

/**
 * Format date and time for display
 */
export const formatDateTime = (date: Date): string => {
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

/**
 * Get current year
 */
export const getCurrentYear = (): number => {
  return new Date().getFullYear();
};

/**
 * Generate year range for time period selection
 */
export const getYearRange = (centerYear?: number): number[] => {
  const center = centerYear || getCurrentYear();
  const years: number[] = [];
  
  for (let i = center - TIME_RANGES.YEAR_RANGE_PAST; i <= center + TIME_RANGES.YEAR_RANGE_FUTURE; i++) {
    years.push(i);
  }
  
  return years;
};

/**
 * Generate months for a given year
 */
export const getMonthsForYear = (year: number) => {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  
  return months.map((month, index) => ({
    value: `${year}-${String(index + 1).padStart(2, '0')}`,
    label: `${month} ${year}`,
    shortLabel: month
  }));
};

/**
 * Generate quarters for a given year
 */
export const getQuartersForYear = (year: number) => {
  return [
    { value: `${year}-Q1`, label: `Q1 ${year} (Jan-Mar)`, shortLabel: 'Q1' },
    { value: `${year}-Q2`, label: `Q2 ${year} (Apr-Jun)`, shortLabel: 'Q2' },
    { value: `${year}-Q3`, label: `Q3 ${year} (Jul-Sep)`, shortLabel: 'Q3' },
    { value: `${year}-Q4`, label: `Q4 ${year} (Oct-Dec)`, shortLabel: 'Q4' },
  ];
};

/**
 * Generate years for selection
 */
export const getYearsForSelection = () => {
  const currentYear = getCurrentYear();
  return getYearRange().map(year => ({
    value: `${year}`,
    label: `${year}`,
    shortLabel: `${year}`
  }));
};

/**
 * Get periods based on frequency
 */
export const getPeriodsForFrequency = (frequency: RequestFrequency, year?: number) => {
  switch (frequency) {
    case 'monthly':
      return year ? getMonthsForYear(year) : [];
    case 'quarterly':
      return year ? getQuartersForYear(year) : [];
    case 'yearly':
      return getYearsForSelection();
    default:
      return [];
  }
};

/**
 * Check if a year is within the valid range
 */
export const isYearInRange = (year: number): boolean => {
  const currentYear = getCurrentYear();
  return year >= currentYear - TIME_RANGES.YEAR_RANGE_PAST && 
         year <= currentYear + TIME_RANGES.YEAR_RANGE_FUTURE;
};

/**
 * Get relative time description (e.g., "2 hours ago")
 */
export const getRelativeTime = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  
  return formatDate(date);
};
