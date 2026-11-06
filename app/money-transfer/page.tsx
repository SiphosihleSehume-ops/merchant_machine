import Link from "next/link";
import { ArrowRight } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { countries } from "@/lib/data";

export default function MoneyTransfer() {
  return (
    <>
      <PageHeader title="Select country" />
      <main className="stack">
        {countries.map((c) => (
          <Link key={c.code} href={`/money-transfer/${c.code.toLowerCase()}`} className="card-link">
            <span className="avatar round" style={{ fontSize: 14, letterSpacing: "0.04em" }}>{c.code}</span>
            <span className="grow">{c.name}</span>
            <ArrowRight size={22} />
          </Link>
        ))}
      </main>
    </>
  );
}
