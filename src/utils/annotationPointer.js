export function clientToPageLocal(clientX, clientY, rect) {
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return null
  }

  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  }
}

export function clientToNormalized(clientX, clientY, rect) {
  const local = clientToPageLocal(clientX, clientY, rect)
  if (!local) {
    return null
  }

  return {
    x: Math.min(1, Math.max(0, local.x / rect.width)),
    y: Math.min(1, Math.max(0, local.y / rect.height)),
  }
}

export function isPointInsidePage(clientX, clientY, rect, paddingPx = 0) {
  const local = clientToPageLocal(clientX, clientY, rect)
  if (!local) {
    return false
  }

  return (
    local.x >= -paddingPx &&
    local.y >= -paddingPx &&
    local.x <= rect.width + paddingPx &&
    local.y <= rect.height + paddingPx
  )
}

export function findScrollableAncestor(element) {
  let node = element?.parentElement
  while (node) {
    const style = getComputedStyle(node)
    const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`
    if (/(auto|scroll|overlay)/.test(overflow)) {
      return node
    }
    node = node.parentElement
  }
  return null
}
