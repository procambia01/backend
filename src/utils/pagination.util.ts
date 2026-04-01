export interface PaginationParams {
  page: number;
  perPage: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginationMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  hasPrevious: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

export class PaginationUtil {
  /**
   * Default pagination values
   */
  static readonly DEFAULT_PAGE = 1;
  static readonly DEFAULT_PER_PAGE = 10;
  static readonly MAX_PER_PAGE = 100;

  /**
   * Parse and validate pagination parameters from query string
   */
  static parseParams(query: any): PaginationParams {
    const page = Math.max(1, parseInt(query.page) || this.DEFAULT_PAGE);
    const perPage = Math.min(
      Math.max(1, parseInt(query.perPage) || parseInt(query.limit) || this.DEFAULT_PER_PAGE),
      this.MAX_PER_PAGE
    );
    const sortBy = query.sortBy || query.sort || 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

    return {
      page,
      perPage,
      sortBy,
      sortOrder,
    };
  }

  /**
   * Calculate skip value for database query
   */
  static calculateSkip(page: number, perPage: number): number {
    return (page - 1) * perPage;
  }

  /**
   * Calculate pagination metadata
   */
  static calculateMeta(
    page: number,
    perPage: number,
    total: number
  ): PaginationMeta {
    const totalPages = Math.ceil(total / perPage);
    const hasMore = page < totalPages;
    const hasPrevious = page > 1;

    return {
      page,
      perPage,
      total,
      totalPages,
      hasMore,
      hasPrevious,
    };
  }

  /**
   * Create paginated result
   */
  static createResult<T>(
    data: T[],
    page: number,
    perPage: number,
    total: number
  ): PaginatedResult<T> {
    return {
      data,
      meta: this.calculateMeta(page, perPage, total),
    };
  }

  /**
   * Get Prisma pagination options
   */
  static getPrismaOptions(params: PaginationParams) {
    return {
      skip: this.calculateSkip(params.page, params.perPage),
      take: params.perPage,
      orderBy: params.sortBy
        ? { [params.sortBy]: params.sortOrder }
        : { createdAt: 'desc' },
    };
  }

  /**
   * Generate pagination links
   */
  static generateLinks(
    baseUrl: string,
    page: number,
    perPage: number,
    totalPages: number
  ): {
    first: string;
    previous: string | null;
    next: string | null;
    last: string;
  } {
    const createUrl = (p: number) => `${baseUrl}?page=${p}&perPage=${perPage}`;

    return {
      first: createUrl(1),
      previous: page > 1 ? createUrl(page - 1) : null,
      next: page < totalPages ? createUrl(page + 1) : null,
      last: createUrl(totalPages),
    };
  }

  /**
   * Cursor-based pagination helper
   */
  static getCursorOptions(
    cursor?: string,
    take: number = this.DEFAULT_PER_PAGE,
    sortBy: string = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc'
  ) {
    const options: any = {
      take: Math.min(take, this.MAX_PER_PAGE),
      orderBy: { [sortBy]: sortOrder },
    };

    if (cursor) {
      options.cursor = { id: cursor };
      options.skip = 1; // Skip the cursor itself
    }

    return options;
  }

  /**
   * Extract cursor from results
   */
  static extractCursor<T extends { id: string }>(
    data: T[]
  ): string | null {
    if (data.length === 0) return null;
    return data[data.length - 1].id;
  }

  /**
   * Create cursor-based pagination result
   */
  static createCursorResult<T extends { id: string }>(
    data: T[],
    take: number
  ): {
    data: T[];
    nextCursor: string | null;
    hasMore: boolean;
  } {
    const hasMore = data.length > take;
    const items = hasMore ? data.slice(0, -1) : data;
    const nextCursor = hasMore ? this.extractCursor(items) : null;

    return {
      data: items,
      nextCursor,
      hasMore,
    };
  }

  /**
   * Validate page number
   */
  static validatePage(page: number, totalPages: number): boolean {
    return page >= 1 && page <= totalPages;
  }

  /**
   * Get offset and limit for SQL-like queries
   */
  static getOffsetLimit(page: number, perPage: number): {
    offset: number;
    limit: number;
  } {
    return {
      offset: this.calculateSkip(page, perPage),
      limit: perPage,
    };
  }
}

export default PaginationUtil;