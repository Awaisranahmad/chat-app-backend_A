// ?page=1&limit=20 — page is 1-based, limit is capped so one request can
// never ask the database for an unbounded list.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePagination(query, options = {}) {
  const defaultLimit = options.defaultLimit || DEFAULT_LIMIT;
  const maxLimit = options.maxLimit || MAX_LIMIT;

  let page = Number.parseInt(query.page, 10);
  let limit = Number.parseInt(query.limit, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;

  return { page, limit, skip: (page - 1) * limit };
}

// The one envelope every paginated list uses.
function pageResponse(items, total, { page, limit }) {
  return {
    success: true,
    data: items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

module.exports = { parsePagination, pageResponse, DEFAULT_LIMIT, MAX_LIMIT };
