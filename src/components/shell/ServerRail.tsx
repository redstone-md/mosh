import { Home, Plus } from 'lucide-react'

import type { RoomGroup } from '../../lib/appShellSchemas'
import { getGroupAccentClass } from '../../lib/chatPresentation'
import { cn } from '../../lib/utils'
import { useI18n } from '../I18nProvider'
import { Button } from '../ui/button'

type ServerRailProps = {
  groups: RoomGroup[]
  selectedDock: 'home' | 'group'
  selectedGroupId: string
  onSelectHome: () => void
  onSelectGroup: (groupId: string) => void
  onOpenCreate: () => void
}

export function ServerRail({
  groups,
  selectedDock,
  selectedGroupId,
  onSelectHome,
  onSelectGroup,
  onOpenCreate,
}: ServerRailProps) {
  const { copy } = useI18n()

  return (
    <aside className="flex w-[72px] shrink-0 flex-col items-center gap-3 border-r border-border bg-[var(--rail)] px-3 py-4">
      <button
        className={cn(
          'flex h-12 w-12 items-center justify-center rounded-2xl transition-all',
          selectedDock === 'home'
            ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
            : 'bg-[var(--panel-strong)] text-foreground hover:bg-[var(--panel-hover)]'
        )}
        onClick={onSelectHome}
        title={copy.sidebar.directMessages}
      >
        <Home className="h-5 w-5" />
      </button>

      <div className="h-px w-8 bg-border" />

      <div className="flex flex-1 flex-col items-center gap-3 overflow-hidden">
        {groups.map((group) => {
          const isActive = selectedDock === 'group' && selectedGroupId === group.id
          return (
            <button
              key={group.id}
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-semibold transition-all',
                isActive
                  ? `${getGroupAccentClass(group)}`
                  : 'bg-[var(--panel-strong)] text-foreground hover:bg-[var(--panel-hover)]'
              )}
              onClick={() => onSelectGroup(group.id)}
              title={group.name}
            >
              {group.icon}
            </button>
          )
        })}
      </div>

      <Button size="icon" variant="secondary" onClick={onOpenCreate} title={copy.sidebar.createSpace}>
        <Plus className="h-4 w-4" />
      </Button>
    </aside>
  )
}
