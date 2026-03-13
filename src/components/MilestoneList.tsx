import type { Milestone } from '../lib/schemas'

type MilestoneListProps = {
  milestones: Milestone[]
}

const labels: Record<Milestone['status'], string> = {
  ready: 'Ready',
  next: 'Next',
  blocked: 'Blocked',
}

const statusColors: Record<Milestone['status'], string> = {
  ready: 'bg-primary/20 text-primary border border-primary/30',
  next: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  blocked: 'bg-red-500/20 text-red-400 border border-red-500/30',
}

export function MilestoneList({ milestones }: MilestoneListProps) {
  return (
    <section className="bg-muted/30 border border-border/20 rounded-3xl p-6 shadow-xl space-y-4">
      <header className="border-b border-border/10 pb-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-primary font-bold mb-1">Roadmap</p>
          <h2 className="text-xl font-bold">Migration steps</h2>
        </div>
      </header>
      <div className="space-y-3">
        {milestones.map((milestone) => (
          <article className="bg-background/40 border border-border/20 rounded-xl p-4 flex flex-col gap-2" key={milestone.title}>
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-bold text-foreground text-sm">{milestone.title}</h3>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${statusColors[milestone.status]}`}>
                {labels[milestone.status]}
              </span>
            </div>
            <p className="text-sm text-foreground/60">{milestone.detail}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

