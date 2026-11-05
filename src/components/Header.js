import Link from "next/link";
import { Suspense } from "react";
import NavLinks, { NavLinksStatic } from "./NavLinks";

export default function Header() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b-[3px] border-ink bg-white px-5">
      <Link href="/" className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-md border-2 border-ink bg-accent font-display text-sm font-bold text-white shadow-[2px_2px_0_var(--ink)]">
          or
        </span>
        <span className="font-display text-xl font-bold tracking-tight">ornaml</span>
      </Link>
      {/* usePathname suspends on dynamic routes, so the nav gets its own boundary. */}
      <Suspense fallback={<NavLinksStatic />}>
        <NavLinks />
      </Suspense>
    </header>
  );
}
