import { describe, expect, it, vi } from 'vitest'

import { applyMessageImageSourcePolicy, isSafeMessageImageSrc } from './messageSanitizer'

class TestNode {
  nodeName = 'IMG'
  removed = false
  parentNode: { removeChild: (node: unknown) => void }
  private readonly attrs: Map<string, string>

  constructor(attrs: Map<string, string>) {
    this.attrs = attrs
    this.parentNode = {
      removeChild: () => {
        this.removed = true
      },
    }
  }

  getAttribute(name: string) {
    return this.attrs.get(name) ?? null
  }

  removeAttribute(name: string) {
    this.attrs.delete(name)
  }

  hasAttribute(name: string) {
    return this.attrs.has(name)
  }
}

describe('messageSanitizer', () => {
  it('blocks remote image sources that would load peer-controlled URLs', () => {
    expect(isSafeMessageImageSrc('https://tracker.example/pixel.png')).toBe(false)
    expect(isSafeMessageImageSrc('http://127.0.0.1:8080/csrf')).toBe(false)
    expect(isSafeMessageImageSrc('file:///etc/passwd')).toBe(false)
  })

  it('allows local bitmap data urls for embedded image attachments', () => {
    expect(isSafeMessageImageSrc('data:image/png;base64,aGVsbG8=')).toBe(true)
    expect(isSafeMessageImageSrc('data:image/webp;base64,aGVsbG8=')).toBe(true)
    expect(isSafeMessageImageSrc('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
    expect(isSafeMessageImageSrc('data:text/html;base64,PGh0bWw+')).toBe(false)
  })

  it('removes unsafe image nodes after DOMPurify sanitizes attributes', () => {
    const node = new TestNode(
      new Map([
        ['src', 'https://tracker.example/pixel.png'],
        ['srcset', 'https://tracker.example/pixel2.png 2x'],
      ])
    )

    applyMessageImageSourcePolicy(node)

    expect(node.removed).toBe(true)
    expect(node.hasAttribute('srcset')).toBe(false)
  })

  it('keeps safe image nodes and strips srcset', () => {
    const node = new TestNode(
      new Map([
        ['src', 'data:image/png;base64,aGVsbG8='],
        ['srcset', 'https://tracker.example/pixel2.png 2x'],
      ])
    )

    applyMessageImageSourcePolicy(node)

    expect(node.removed).toBe(false)
    expect(node.hasAttribute('srcset')).toBe(false)
  })

  it('ignores non-image nodes', () => {
    const node = new TestNode(new Map([['src', 'https://tracker.example/pixel.png']]))
    node.nodeName = 'A'
    node.parentNode.removeChild = vi.fn()

    applyMessageImageSourcePolicy(node)

    expect(node.parentNode.removeChild).not.toHaveBeenCalled()
  })
})
