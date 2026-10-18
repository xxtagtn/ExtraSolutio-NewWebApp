export function collaboratorPickerPlacement(rect, viewport) {
  const { width, height, layoutWidth = width, layoutHeight = height, offsetTop = 0, offsetLeft = 0 } = viewport;
  const edge = layoutWidth <= 760 ? 10 : 16;
  const usableWidth = Math.max(0, width - edge * 2);
  if (layoutWidth <= 760) {
    return {
      left: offsetLeft + edge,
      top: undefined,
      bottom: Math.max(0, layoutHeight - offsetTop - height) + edge,
      width: usableWidth,
      maxHeight: Math.min(520, Math.max(0, height - edge * 2)),
    };
  }
  const below = Math.max(0, offsetTop + height - rect.bottom - edge);
  const above = Math.max(0, rect.top - offsetTop - edge);
  const openAbove = below < 220 && above > below;
  const menuWidth = Math.min(rect.width, usableWidth);
  return {
    left: Math.max(offsetLeft + edge, Math.min(rect.left, offsetLeft + width - edge - menuWidth)),
    top: openAbove ? undefined : Math.max(offsetTop + edge, rect.bottom + 6),
    bottom: openAbove ? Math.max(edge, layoutHeight - rect.top + 6) : undefined,
    width: menuWidth,
    maxHeight: Math.min(320, Math.max(0, (openAbove ? above : below) - 6)),
  };
}
