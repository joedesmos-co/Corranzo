import { XMLParser } from 'fast-xml-parser'

/**
 * Ordered XML tree built on fast-xml-parser's preserveOrder mode.
 * MusicXML semantics depend on document order (notes vs directions vs
 * backup/forward), so the app parser must never sort children by tag name.
 *
 * Node shape: { tag, attrs, children: rawArray }
 */

export function parseXmlOrdered(xmlString) {
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: true,
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
  })
  return parser.parse(xmlString)
}

export function toNode(raw) {
  if (raw == null) {
    return null
  }
  const tag = Object.keys(raw).find((key) => key !== ':@' && key !== '#text')
  if (!tag) {
    return null
  }
  return { tag, attrs: raw[':@'] ?? {}, children: raw[tag] ?? [] }
}

/** All element children, in document order. */
export function childNodes(node) {
  if (!node?.children?.length) {
    return []
  }
  const nodes = []
  for (const raw of node.children) {
    const child = toNode(raw)
    if (child) {
      nodes.push(child)
    }
  }
  return nodes
}

/** Concatenated text content of a node's direct #text children. */
export function textOf(node) {
  if (!node?.children?.length) {
    return null
  }
  let text = null
  for (const raw of node.children) {
    if (raw['#text'] !== undefined) {
      text = text == null ? String(raw['#text']) : text + String(raw['#text'])
    }
  }
  return text
}

export function findChild(node, tag) {
  for (const raw of node?.children ?? []) {
    const child = toNode(raw)
    if (child?.tag === tag) {
      return child
    }
  }
  return null
}

export function findChildren(node, tag) {
  return childNodes(node).filter((child) => child.tag === tag)
}

/** Text of the first child with the given tag. */
export function childText(node, tag) {
  const child = findChild(node, tag)
  return child ? textOf(child) : null
}

export function attr(node, name) {
  const value = node?.attrs?.[name]
  return value === undefined ? null : value
}

export function numberOf(value, fallback = NaN) {
  if (value == null || value === '') {
    return fallback
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Find the root element node by tag among the top-level parse output. */
export function rootElement(parsed, tag) {
  for (const raw of parsed ?? []) {
    const node = toNode(raw)
    if (node?.tag === tag) {
      return node
    }
  }
  return null
}
