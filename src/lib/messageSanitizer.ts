import DOMPurify from 'dompurify'

const SAFE_IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,[a-z0-9+/=\s]+$/i

const MESSAGE_SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'em',
    's',
    'u',
    'code',
    'pre',
    'blockquote',
    'ul',
    'ol',
    'li',
    'a',
    'span',
    'img',
  ],
  ALLOWED_ATTR: [
    'href',
    'target',
    'rel',
    'class',
    'data-reply-to',
    'data-attachment',
    'data-file-name',
    'data-file-size',
    'data-file-type',
    'data-file-url',
    'download',
    'title',
    'alt',
    'src',
  ],
  FORBID_ATTR: ['style', 'srcset'],
  FORBID_TAGS: ['audio', 'embed', 'iframe', 'object', 'picture', 'source', 'track', 'video'],
}

let hooksInstalled = false

type MessageSanitizerNode = {
  nodeName: string
  getAttribute: (name: string) => string | null
  removeAttribute: (name: string) => void
  parentNode?: { removeChild: (node: unknown) => unknown } | null
}

export function sanitizeMessageMarkup(body: string): string {
  ensureMessageSanitizerHooks()
  return DOMPurify.sanitize(body, MESSAGE_SANITIZE_CONFIG)
}

export function isSafeMessageImageSrc(value: string): boolean {
  return SAFE_IMAGE_DATA_URL_PATTERN.test(value.trim())
}

export function applyMessageImageSourcePolicy(node: MessageSanitizerNode): void {
  if (node.nodeName.toLowerCase() !== 'img') {
    return
  }

  node.removeAttribute('srcset')
  const src = node.getAttribute('src')
  if (!src || !isSafeMessageImageSrc(src)) {
    node.parentNode?.removeChild(node)
  }
}

function ensureMessageSanitizerHooks(): void {
  if (hooksInstalled || typeof DOMPurify.addHook !== 'function') {
    return
  }

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    applyMessageImageSourcePolicy(node as unknown as MessageSanitizerNode)
  })
  hooksInstalled = true
}
