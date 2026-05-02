import * as React from 'react'

import { cn } from '../../lib/utils'

type AvatarContextValue = {
  loaded: boolean
  setLoaded: (value: boolean) => void
}

const AvatarContext = React.createContext<AvatarContextValue | null>(null)

export const Avatar = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, children, ...props }, ref) => {
    const [loaded, setLoaded] = React.useState(false)

    return (
      <AvatarContext.Provider value={{ loaded, setLoaded }}>
        <span
          ref={ref}
          className={cn('relative flex h-9 w-9 shrink-0 overflow-hidden rounded-full', className)}
          {...props}
        >
          {children}
        </span>
      </AvatarContext.Provider>
    )
  }
)

Avatar.displayName = 'Avatar'

export const AvatarImage = React.forwardRef<HTMLImageElement, React.ImgHTMLAttributes<HTMLImageElement>>(
  ({ className, onLoad, ...props }, ref) => {
    const context = React.useContext(AvatarContext)

    return (
      <img
        ref={ref}
        className={cn('aspect-square h-full w-full', context?.loaded ? 'block' : 'hidden', className)}
        onLoad={(event) => {
          context?.setLoaded(true)
          onLoad?.(event)
        }}
        {...props}
      />
    )
  }
)

AvatarImage.displayName = 'AvatarImage'

export const AvatarFallback = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => {
    const context = React.useContext(AvatarContext)

    if (context?.loaded) {
      return null
    }

    return (
      <span
        ref={ref}
        className={cn(
          'flex h-full w-full items-center justify-center rounded-full bg-[var(--panel-strong)] text-sm font-semibold text-foreground',
          className
        )}
        {...props}
      />
    )
  }
)

AvatarFallback.displayName = 'AvatarFallback'
