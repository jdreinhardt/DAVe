// Stub page for Journals (Milestone 8).
// The full implementation (Timeline, List, Calendar views) is in the next milestone.
export default function JournalsPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
      <div className="text-4xl mb-4">📖</div>
      <h2 className="text-base font-semibold text-foreground mb-1">Journals</h2>
      <p className="text-sm text-muted-foreground max-w-xs">
        Journals (dated entries) are coming in the next milestone. Entries converted from Notes will
        be stored here and available once the full view is implemented.
      </p>
    </div>
  );
}
