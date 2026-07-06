function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parsePaginationQuery(query = {}, options = {}) {
  const requested = query.page !== undefined || query.pageSize !== undefined || query.limit !== undefined;
  if (!requested) return { enabled: false };

  const maxPageSize = positiveInteger(options.maxPageSize, 100);
  const defaultPageSize = positiveInteger(options.defaultPageSize, 20);
  const page = positiveInteger(query.page, 1);
  const rawPageSize = positiveInteger(query.pageSize ?? query.limit, defaultPageSize);
  const pageSize = Math.min(maxPageSize, Math.max(1, rawPageSize));

  return {
    enabled: true,
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

export function buildPaginatedPayload({ items = [], total = 0, page = 1, pageSize = 20 } = {}) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safePageSize = Math.max(1, Number(pageSize) || 20);
  return {
    items,
    total: safeTotal,
    page: Math.max(1, Number(page) || 1),
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(safeTotal / safePageSize)),
  };
}
