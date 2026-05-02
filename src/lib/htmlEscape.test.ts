import { describe, expect, it } from 'vitest'

import { escapeHtml, escapeHtmlAttribute } from './htmlEscape'

describe('htmlEscape', () => {
  it('escapes text before reinserting it into editor HTML', () => {
    expect(escapeHtml('&lt;img src=x onerror=alert(1)&gt;')).toBe('&amp;lt;img src=x onerror=alert(1)&amp;gt;')
  })

  it('escapes quoted attribute values', () => {
    expect(escapeHtmlAttribute('message" onmouseover="alert(1)')).toBe('message&quot; onmouseover=&quot;alert(1)')
    expect(escapeHtmlAttribute("message' onclick='alert(1)")).toBe('message&#39; onclick=&#39;alert(1)')
  })
})
