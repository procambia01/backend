//src/
import {
  format,
  formatDistance,
  formatRelative,
  addDays,
  addHours,
  addMinutes,
  addMonths,
  addYears,
  subDays,
  subHours,
  subMinutes,
  subMonths,
  subYears,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  isAfter,
  isBefore,
  isEqual,
  isFuture,
  isPast,
  isToday,
  isYesterday,
  isTomorrow,
  isThisWeek,
  isThisMonth,
  isThisYear,
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  differenceInSeconds,
  parseISO,
} from 'date-fns';

export class DateUtil {
  /**
   * Format date to string
   */
  static format(date: Date | string, formatStr: string = 'yyyy-MM-dd HH:mm:ss'): string {
    const d = typeof date === 'string' ? parseISO(date) : date;
    return format(d, formatStr);
  }

  /**
   * Format date to ISO string
   */
  static toISO(date: Date): string {
    return date.toISOString();
  }

  /**
   * Parse ISO string to Date
   */
  static parseISO(dateStr: string): Date {
    return parseISO(dateStr);
  }

  /**
   * Format date to readable string (e.g., "2 days ago")
   */
  static formatRelative(date: Date | string, baseDate: Date = new Date()): string {
    const d = typeof date === 'string' ? parseISO(date) : date;
    return formatDistance(d, baseDate, { addSuffix: true });
  }

  /**
   * Format date relative to now (e.g., "last Friday at 2:30 PM")
   */
  static formatRelativeToNow(date: Date | string): string {
    const d = typeof date === 'string' ? parseISO(date) : date;
    return formatRelative(d, new Date());
  }

  /**
   * Get current timestamp
   */
  static now(): Date {
    return new Date();
  }

  /**
   * Get current timestamp in milliseconds
   */
  static timestamp(): number {
    return Date.now();
  }

  /**
   * Add days to date
   */
  static addDays(date: Date, days: number): Date {
    return addDays(date, days);
  }

  /**
   * Add hours to date
   */
  static addHours(date: Date, hours: number): Date {
    return addHours(date, hours);
  }

  /**
   * Add minutes to date
   */
  static addMinutes(date: Date, minutes: number): Date {
    return addMinutes(date, minutes);
  }

  /**
   * Add months to date
   */
  static addMonths(date: Date, months: number): Date {
    return addMonths(date, months);
  }

  /**
   * Add years to date
   */
  static addYears(date: Date, years: number): Date {
    return addYears(date, years);
  }

  /**
   * Subtract days from date
   */
  static subDays(date: Date, days: number): Date {
    return subDays(date, days);
  }

  /**
   * Subtract hours from date
   */
  static subHours(date: Date, hours: number): Date {
    return subHours(date, hours);
  }

  /**
   * Subtract minutes from date
   */
  static subMinutes(date: Date, minutes: number): Date {
    return subMinutes(date, minutes);
  }

  /**
   * Subtract months from date
   */
  static subMonths(date: Date, months: number): Date {
    return subMonths(date, months);
  }

  /**
   * Subtract years from date
   */
  static subYears(date: Date, years: number): Date {
    return subYears(date, years);
  }

  /**
   * Get start of day
   */
  static startOfDay(date: Date = new Date()): Date {
    return startOfDay(date);
  }

  /**
   * Get end of day
   */
  static endOfDay(date: Date = new Date()): Date {
    return endOfDay(date);
  }

  /**
   * Get start of week
   */
  static startOfWeek(date: Date = new Date()): Date {
    return startOfWeek(date);
  }

  /**
   * Get end of week
   */
  static endOfWeek(date: Date = new Date()): Date {
    return endOfWeek(date);
  }

  /**
   * Get start of month
   */
  static startOfMonth(date: Date = new Date()): Date {
    return startOfMonth(date);
  }

  /**
   * Get end of month
   */
  static endOfMonth(date: Date = new Date()): Date {
    return endOfMonth(date);
  }

  /**
   * Get start of year
   */
  static startOfYear(date: Date = new Date()): Date {
    return startOfYear(date);
  }

  /**
   * Get end of year
   */
  static endOfYear(date: Date = new Date()): Date {
    return endOfYear(date);
  }

  /**
   * Check if date is after another date
   */
  static isAfter(date: Date, dateToCompare: Date): boolean {
    return isAfter(date, dateToCompare);
  }

  /**
   * Check if date is before another date
   */
  static isBefore(date: Date, dateToCompare: Date): boolean {
    return isBefore(date, dateToCompare);
  }

  /**
   * Check if dates are equal
   */
  static isEqual(date: Date, dateToCompare: Date): boolean {
    return isEqual(date, dateToCompare);
  }

  /**
   * Check if date is in the future
   */
  static isFuture(date: Date): boolean {
    return isFuture(date);
  }

  /**
   * Check if date is in the past
   */
  static isPast(date: Date): boolean {
    return isPast(date);
  }

  /**
   * Check if date is today
   */
  static isToday(date: Date): boolean {
    return isToday(date);
  }

  /**
   * Check if date is yesterday
   */
  static isYesterday(date: Date): boolean {
    return isYesterday(date);
  }

  /**
   * Check if date is tomorrow
   */
  static isTomorrow(date: Date): boolean {
    return isTomorrow(date);
  }

  /**
   * Check if date is this week
   */
  static isThisWeek(date: Date): boolean {
    return isThisWeek(date);
  }

  /**
   * Check if date is this month
   */
  static isThisMonth(date: Date): boolean {
    return isThisMonth(date);
  }

  /**
   * Check if date is this year
   */
  static isThisYear(date: Date): boolean {
    return isThisYear(date);
  }

  /**
   * Get difference in days
   */
  static diffInDays(dateLeft: Date, dateRight: Date): number {
    return differenceInDays(dateLeft, dateRight);
  }

  /**
   * Get difference in hours
   */
  static diffInHours(dateLeft: Date, dateRight: Date): number {
    return differenceInHours(dateLeft, dateRight);
  }

  /**
   * Get difference in minutes
   */
  static diffInMinutes(dateLeft: Date, dateRight: Date): number {
    return differenceInMinutes(dateLeft, dateRight);
  }

  /**
   * Get difference in seconds
   */
  static diffInSeconds(dateLeft: Date, dateRight: Date): number {
    return differenceInSeconds(dateLeft, dateRight);
  }

  /**
   * Check if date is between two dates
   */
  static isBetween(date: Date, startDate: Date, endDate: Date): boolean {
    return isAfter(date, startDate) && isBefore(date, endDate);
  }

  /**
   * Get age from birth date
   */
  static getAge(birthDate: Date): number {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age;
  }

  /**
   * Format duration in human-readable format
   */
  static formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(' ');
  }

  /**
   * Get date range for a period
   */
  static getDateRange(period: 'today' | 'yesterday' | 'week' | 'month' | 'year'): {
    start: Date;
    end: Date;
  } {
    const now = new Date();

    switch (period) {
      case 'today':
        return {
          start: startOfDay(now),
          end: endOfDay(now),
        };
      case 'yesterday':
        return {
          start: startOfDay(subDays(now, 1)),
          end: endOfDay(subDays(now, 1)),
        };
      case 'week':
        return {
          start: startOfWeek(now),
          end: endOfWeek(now),
        };
      case 'month':
        return {
          start: startOfMonth(now),
          end: endOfMonth(now),
        };
      case 'year':
        return {
          start: startOfYear(now),
          end: endOfYear(now),
        };
    }
  }

  /**
   * Convert minutes to hours and minutes
   */
  static minutesToHoursMinutes(minutes: number): { hours: number; minutes: number } {
    return {
      hours: Math.floor(minutes / 60),
      minutes: minutes % 60,
    };
  }

  /**
   * Get time from now (for expiry, etc.)
   */
  static fromNow(date: Date | string): string {
    const d = typeof date === 'string' ? parseISO(date) : date;
    return formatDistance(d, new Date());
  }

  /**
   * Check if date is expired
   */
  static isExpired(date: Date): boolean {
    return isPast(date);
  }

  /**
   * Get expiry status
   */
  static getExpiryStatus(expiryDate: Date): {
    isExpired: boolean;
    timeRemaining: string;
  } {
    const now = new Date();
    const isExpired = isPast(expiryDate);
    const timeRemaining = isExpired
      ? 'Expired'
      : formatDistance(expiryDate, now, { addSuffix: true });

    return { isExpired, timeRemaining };
  }
}

export default DateUtil;