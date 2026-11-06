import Link from "next/link";
import { ChevronRight } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { tiles } from "@/lib/nav";

export default function Menu() {
  return (
    <>
      <PageHeader title="Menu" />
      <main className="stack" style={{ gap: 10 }}>
        {tiles.map(({ href, label, Icon }) => (
          <Link key={href} href={href} className="card-link">
            <Icon size={26} color="var(--accent)" strokeWidth={1.7} />
            <span className="grow">{label}</span>
            <ChevronRight size={20} />
          </Link>
        ))}
      </main>
    </>
  );
}
