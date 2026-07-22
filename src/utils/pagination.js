function visiblePageNumbers(totalPages, currentPage, maximum = 5) {
  const visibleCount = Math.min(totalPages, maximum);
  const half = Math.floor(visibleCount / 2);
  const start = Math.min(
    Math.max(1, currentPage - half),
    Math.max(1, totalPages - visibleCount + 1),
  );

  return Array.from({ length: visibleCount }, (_, index) => start + index);
}

export function paginateItems(items = [], requestedPage = 1, requestedPageSize = 10) {
  const collection = Array.isArray(items) ? items : [];
  const pageSize = Math.max(1, Number(requestedPageSize) || 10);
  const totalItems = collection.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(
    totalPages,
    Math.max(1, Number(requestedPage) || 1),
  );
  const offset = (currentPage - 1) * pageSize;
  const pageItems = collection.slice(offset, offset + pageSize);

  return {
    items: pageItems,
    currentPage,
    pageSize,
    totalItems,
    totalPages,
    startItem: totalItems ? offset + 1 : 0,
    endItem: totalItems ? offset + pageItems.length : 0,
    pageNumbers: visiblePageNumbers(totalPages, currentPage),
  };
}

export function reconcileServerPage(requestedPage, payloadPage, totalPages) {
  const requested = Math.max(1, Number(requestedPage) || 1);
  const payload = Math.max(1, Number(payloadPage) || 1);
  if (payload !== requested) return requested;
  return Math.min(Math.max(1, Number(totalPages) || 1), payload);
}
