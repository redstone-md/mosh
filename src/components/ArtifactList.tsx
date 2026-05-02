import type { Artifact } from '../lib/schemas'

type ArtifactListProps = {
  artifacts: Artifact[]
}

export function ArtifactList({ artifacts }: ArtifactListProps) {
  return (
    <section className="bg-muted/30 border border-border/20 rounded-3xl p-6 shadow-xl space-y-4">
      <header className="border-b border-border/10 pb-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-primary font-bold mb-1">Artifacts</p>
          <h2 className="text-xl font-bold">Expected desktop outputs</h2>
        </div>
      </header>
      <div className="space-y-3">
        {artifacts.map((artifact) => (
          <article
            className="bg-background/40 border border-border/20 rounded-xl p-4 flex flex-col gap-2"
            key={artifact.name}
          >
            <div className="flex flex-col gap-0.5">
              <h3 className="font-bold text-foreground text-sm">{artifact.name}</h3>
              <p className="text-[10px] text-foreground/50 uppercase tracking-wider">{artifact.platform}</p>
            </div>
            <p className="text-sm text-foreground/60">{artifact.notes}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
