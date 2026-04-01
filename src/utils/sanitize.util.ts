import validator from 'validator';

export class SanitizeUtil {
  /**
   * Escape HTML to prevent XSS
   */
  static escapeHtml(text: string): string {
    return validator.escape(text);
  }

  /**
   * Unescape HTML
   */
  static unescapeHtml(text: string): string {
    return validator.unescape(text);
  }

  /**
   * Strip HTML tags
   */
  static stripHtml(text: string): string {
    return text.replace(/<[^>]*>/g, '');
  }

  /**
   * Sanitize email
   */
  static email(email: string): string {
    return validator.normalizeEmail(email) || email.toLowerCase().trim();
  }

  /**
   * Sanitize phone number
   */
  static phone(phone: string): string {
    // Remove all non-numeric characters except +
    return phone.replace(/[^\d+]/g, '');
  }

  /**
   * Sanitize string (trim and lowercase)
   */
  static string(text: string): string {
    return text.trim();
  }

  /**
   * Sanitize URL
   */
  static url(url: string): string {
    return validator.trim(url);
  }

  /**
   * Remove whitespace from string
   */
  static removeWhitespace(text: string): string {
    return text.replace(/\s+/g, '');
  }

  /**
   * Remove special characters (keep only alphanumeric)
   */
  static removeSpecialChars(text: string): string {
    return text.replace(/[^a-zA-Z0-9]/g, '');
  }

  /**
   * Remove non-alphanumeric except spaces
   */
  static alphanumericWithSpaces(text: string): string {
    return text.replace(/[^a-zA-Z0-9\s]/g, '');
  }

  /**
   * Sanitize filename
   */
  static filename(filename: string): string {
    // Remove path separators and special chars
    return filename
      .replace(/[/\\]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .trim();
  }

  /**
   * Sanitize MongoDB query (prevent NoSQL injection)
   */
  static mongoQuery(value: any): any {
    if (typeof value === 'string') {
      // Remove MongoDB operators
      return value.replace(/[${}]/g, '');
    }
    
    if (typeof value === 'object' && value !== null) {
      const sanitized: any = Array.isArray(value) ? [] : {};
      
      for (const key in value) {
        // Skip MongoDB operators
        if (key.startsWith('$')) continue;
        
        sanitized[key] = this.mongoQuery(value[key]);
      }
      
      return sanitized;
    }
    
    return value;
  }

  /**
   * Sanitize object (recursive)
   */
  static object(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.object(item));
    }

    const sanitized: any = {};
    
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        sanitized[key] = this.string(obj[key]);
      } else if (typeof obj[key] === 'object') {
        sanitized[key] = this.object(obj[key]);
      } else {
        sanitized[key] = obj[key];
      }
    }

    return sanitized;
  }

  /**
   * Sanitize boolean value
   */
  static boolean(value: any): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
    }
    return Boolean(value);
  }

  /**
   * Sanitize number
   */
  static number(value: any): number | null {
    const num = Number(value);
    return isNaN(num) ? null : num;
  }

  /**
   * Sanitize integer
   */
  static integer(value: any): number | null {
    const num = parseInt(value, 10);
    return isNaN(num) ? null : num;
  }

  /**
   * Sanitize float
   */
  static float(value: any): number | null {
    const num = parseFloat(value);
    return isNaN(num) ? null : num;
  }

  /**
   * Sanitize array
   */
  static array(value: any): any[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [value];
      } catch {
        return [value];
      }
    }
    return [value];
  }

  /**
   * Remove null/undefined values from object
   */
  static removeEmpty(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.filter(item => item !== null && item !== undefined);
    }

    const sanitized: any = {};
    
    for (const key in obj) {
      if (obj[key] !== null && obj[key] !== undefined) {
        sanitized[key] = this.removeEmpty(obj[key]);
      }
    }

    return sanitized;
  }

  /**
   * Truncate string to max length
   */
  static truncate(text: string, maxLength: number, suffix: string = '...'): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - suffix.length) + suffix;
  }

  /**
   * Normalize whitespace (replace multiple spaces with single space)
   */
  static normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Remove leading/trailing slashes
   */
  static trimSlashes(text: string): string {
    return text.replace(/^\/+|\/+$/g, '');
  }

  /**
   * Sanitize username
   */
  static username(username: string): string {
    return username
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .substring(0, 30);
  }

  /**
   * Sanitize slug
   */
  static slug(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Remove SQL injection patterns
   */
  static removeSQL(text: string): string {
    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi,
      /(--|;|\/\*|\*\/|xp_|sp_)/gi,
      /('|(\\')|(--)|(%27)|(%23)|(#))/gi,
    ];

    let sanitized = text;
    sqlPatterns.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '');
    });

    return sanitized;
  }

  /**
   * Sanitize credit card number (for display)
   */
  static maskCreditCard(cardNumber: string): string {
    const cleaned = cardNumber.replace(/\s/g, '');
    if (cleaned.length < 4) return cleaned;
    return '*'.repeat(cleaned.length - 4) + cleaned.slice(-4);
  }

  /**
   * Sanitize JSON string
   */
  static json(value: string): any | null {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  /**
   * Remove dangerous characters
   */
  static removeDangerous(text: string): string {
    return text.replace(/[<>'"&]/g, '');
  }

  /**
   * Sanitize search query
   */
  static searchQuery(query: string): string {
    return query
      .trim()
      .replace(/[<>'"]/g, '')
      .substring(0, 100);
  }

  /**
   * Validate and sanitize date string
   */
  static date(dateStr: string): Date | null {
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  }
}

export default SanitizeUtil;