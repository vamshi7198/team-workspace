export function SimplePage({ title, description, actions, children, wide }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto px-6 pb-16 pt-14 sm:px-10 ${wide ? "max-w-6xl" : "max-w-4xl"}`}>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
