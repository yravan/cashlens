export function countList(counts: [number, string][]): string {
  const clauses = counts
    .filter(([count]) => count > 0)
    .map(([count, noun]) => `${count} ${noun}${count === 1 ? "" : "s"}`);
  if (clauses.length < 3) return clauses.join(" and ");
  return `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}`;
}
