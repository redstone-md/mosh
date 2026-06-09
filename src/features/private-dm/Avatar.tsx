export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/[\s_-]+/)
    .map((part) => part[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return <span className="avatar">{initials || "?"}</span>;
}
