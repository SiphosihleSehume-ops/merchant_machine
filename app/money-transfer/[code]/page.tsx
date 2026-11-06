import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { Banknote } from "lucide-react";
import { countries } from "@/lib/data";

export default async function CountryTransfer({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const country = countries.find((c) => c.code.toLowerCase() === code.toLowerCase());
  if (!country) notFound();
  return (
    <>
      <PageHeader title={`Send to ${country.name}`} />
      <main>
        <EmptyState title="Transfer flow coming soon" icon={<Banknote size={52} strokeWidth={1.4} />}>
          Recipient and amount screens will be added here.
        </EmptyState>
      </main>
    </>
  );
}
