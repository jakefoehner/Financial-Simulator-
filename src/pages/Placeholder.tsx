import { Card, PageHeader } from "../components/Card";

export default function Placeholder({ title, phase }: { title: string; phase: number }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <p className="text-sm text-[var(--muted)]">Coming in Phase {phase}.</p>
      </Card>
    </>
  );
}
