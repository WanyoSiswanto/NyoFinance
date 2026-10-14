import Link from "next/link";

export function Navbar({
  email,
  action,
}: {
  email?: string | null;
  action?: React.ReactNode;
}) {
  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href={email ? "/dashboard" : "/"} className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-700 text-sm font-bold text-white">
            NF
          </span>
          <span className="text-base font-semibold tracking-tight">NyoFinance</span>
        </Link>
        <div className="flex items-center gap-3">
          {email ? (
            <span className="hidden max-w-48 truncate text-sm text-stone-600 sm:block">
              {email}
            </span>
          ) : (
            <>
              <Link href="/login" className="text-sm font-medium text-stone-700 hover:text-teal-800">
                Masuk
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-teal-800"
              >
                Daftar
              </Link>
            </>
          )}
          {action}
        </div>
      </div>
    </header>
  );
}

export function PageShell({
  email,
  action,
  children,
  narrow,
}: {
  email?: string | null;
  action?: React.ReactNode;
  children: React.ReactNode;
  narrow?: boolean;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <Navbar email={email} action={action} />
      <main className={`mx-auto w-full flex-1 px-4 py-8 sm:px-6 ${narrow ? "max-w-md" : "max-w-5xl"}`}>
        {children}
      </main>
      <footer className="border-t border-stone-200 bg-white py-4 text-center text-xs text-stone-500">
        NyoFinance — Fase 1: fondasi &amp; workspace keluarga
      </footer>
    </div>
  );
}
