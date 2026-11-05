"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Documents" },
  { href: "/settings", label: "Settings" },
];

function Nav({ pathname }) {
  return (
    <nav className="flex gap-3">
      {NAV.map((n) => {
        const active =
          pathname != null &&
          (n.href === "/" ? pathname === "/" || pathname.startsWith("/documents") : pathname.startsWith(n.href));
        return (
          <Link key={n.href} href={n.href} className={`nb-btn nb-btn-sm ${active ? "nb-btn-primary" : ""}`}>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function NavLinksStatic() {
  return <Nav pathname={null} />;
}

export default function NavLinks() {
  return <Nav pathname={usePathname()} />;
}
