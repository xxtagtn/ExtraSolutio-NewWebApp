export function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

export function pick(source, keys) {
  return keys.reduce((payload, key) => {
    if (source[key] !== undefined) {
      payload[key] = source[key];
    }
    return payload;
  }, {});
}

export function toDate(value) {
  return value ? new Date(value) : undefined;
}
