import * as React from 'react'

import { cn } from '../../lib/utils'

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'danger'

const classes: Record<BadgeVariant, string> = {
  default: 'bg-[var(--accent-soft)] text-[var(--accent-foreground)]',
  secondary: 'bg-[var(--panel-strong)] text-foreground',
  outline: 'border border-border bg-transparent text-[var(--muted-foreground)]',
  danger: 'bg-[color-mix(in_oklab,var(--danger),transparent_85%)] text-[var(--danger)]',
}

export function Badge({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        classes[variant],
        className,
      )}
      {...props}
    />
  )
}
