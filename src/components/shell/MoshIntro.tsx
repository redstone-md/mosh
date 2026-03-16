import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Shield, Waypoints, Waves } from 'lucide-react'

import { useI18n } from '../I18nProvider'
import { Button } from '../ui/button'

const INTRO_DURATION_MS = 3000

type MoshIntroProps = {
  onComplete: () => void
}

export function MoshIntro({ onComplete }: MoshIntroProps) {
  const { copy } = useI18n()
  const introSteps = [
    {
      icon: Shield,
      label: copy.intro.steps[0].label,
      detail: copy.intro.steps[0].detail,
      delay: 0.2,
    },
    {
      icon: Waypoints,
      label: copy.intro.steps[1].label,
      detail: copy.intro.steps[1].detail,
      delay: 0.7,
    },
    {
      icon: Waves,
      label: copy.intro.steps[2].label,
      detail: copy.intro.steps[2].detail,
      delay: 1.2,
    },
  ]

  useEffect(() => {
    const timeout = window.setTimeout(onComplete, INTRO_DURATION_MS)
    return () => window.clearTimeout(timeout)
  }, [onComplete])

  return (
    <section className="flex flex-1 items-center justify-center bg-[var(--app)] px-6 py-8 text-foreground">
      <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <motion.section
          className="rounded-lg border border-border bg-[var(--panel)] p-6"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
        >
          <div className="flex items-center gap-3">
            <motion.div
              className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--panel-strong)] text-sm font-semibold"
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
            >
              M
            </motion.div>
            <div className="text-sm font-semibold tracking-[0.2em] text-foreground/75">MOSH</div>
          </div>

          <div className="mt-5 max-w-md text-sm leading-6 text-[var(--muted-foreground)]">
            {copy.intro.summary}
          </div>

          <div className="mt-8 overflow-hidden rounded-md border border-border bg-[var(--chat)]">
            <svg viewBox="0 0 620 280" className="block h-auto w-full">
              <motion.path
                d="M104 152L226 98L332 150L454 104L540 146"
                fill="none"
                stroke="var(--border)"
                strokeWidth="1.5"
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0.35 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 1.3, ease: 'easeInOut' }}
              />
              <motion.path
                d="M104 152L226 206L332 150L454 200L540 146"
                fill="none"
                stroke="color-mix(in srgb, var(--primary) 52%, transparent)"
                strokeWidth="1.5"
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ delay: 0.45, duration: 1.2, ease: 'easeInOut' }}
              />

              {[
                { cx: 104, cy: 152, delay: 0.05 },
                { cx: 226, cy: 98, delay: 0.3 },
                { cx: 226, cy: 206, delay: 0.55 },
                { cx: 332, cy: 150, delay: 0.8 },
                { cx: 454, cy: 104, delay: 1.05 },
                { cx: 454, cy: 200, delay: 1.3 },
                { cx: 540, cy: 146, delay: 1.55 },
              ].map((node) => (
                <g key={`${node.cx}-${node.cy}`}>
                  <motion.circle
                    cx={node.cx}
                    cy={node.cy}
                    r="10"
                    fill="var(--panel-strong)"
                    stroke="var(--border)"
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: node.delay, duration: 0.24, ease: 'easeOut' }}
                  />
                  <motion.circle
                    cx={node.cx}
                    cy={node.cy}
                    r="3.5"
                    fill="var(--primary)"
                    initial={{ scale: 0, opacity: 0.5 }}
                    animate={{ scale: [0.9, 1.4, 1], opacity: [0.4, 1, 0.85] }}
                    transition={{ delay: node.delay + 0.08, duration: 0.5, ease: 'easeOut' }}
                  />
                </g>
              ))}

              <motion.rect
                x="258"
                y="118"
                width="148"
                height="64"
                rx="8"
                fill="var(--panel)"
                stroke="color-mix(in srgb, var(--primary) 40%, var(--border))"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.4, duration: 0.35 }}
              />
              <motion.text
                x="278"
                y="144"
                fill="var(--foreground)"
                fontSize="14"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.86 }}
                transition={{ delay: 1.55, duration: 0.3 }}
              >
                {copy.intro.roomLabel}
              </motion.text>
              <motion.text
                x="278"
                y="165"
                fill="var(--muted-foreground)"
                fontSize="12"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.7, duration: 0.3 }}
              >
                {copy.intro.roomDetail}
              </motion.text>
            </svg>
          </div>
        </motion.section>

        <div className="flex flex-col rounded-lg border border-border bg-[var(--panel)] p-6">
          <div className="space-y-3">
            {introSteps.map((step) => {
              const Icon = step.icon

              return (
                <motion.div
                  key={step.label}
                  className="flex gap-3 rounded-md border border-border bg-[var(--chat)] p-4"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: step.delay, duration: 0.32, ease: 'easeOut' }}
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-[var(--panel-strong)] text-primary">
                    <Icon size={15} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">{step.label}</div>
                    <div className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">{step.detail}</div>
                  </div>
                </motion.div>
              )
            })}
          </div>

          <div className="mt-auto pt-6">
            <div className="mb-3 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
              <span>{copy.intro.countdown}</span>
              <span className="flex items-center gap-1 text-foreground/70">
                {copy.common.continue}
                <ArrowRight size={12} />
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-[var(--chat)]">
              <motion.div
                className="h-full bg-[var(--primary)]"
                initial={{ width: 0 }}
                animate={{ width: '100%' }}
                transition={{ duration: INTRO_DURATION_MS / 1000, ease: 'linear' }}
              />
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="ghost" size="sm" onClick={onComplete}>
                {copy.intro.skip}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
