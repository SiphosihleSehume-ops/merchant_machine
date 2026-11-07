import { HandCoins } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";

export default function StockAdvance() {
  return (
    <>
      <PageHeader title="Available stock advance" />
      <main>
        <EmptyState title="Something is on its way" icon={<HandCoins size={52} strokeWidth={1.4} />}>
          Stock advance isn&apos;t available yet. Check back soon.
        </EmptyState>
      </main>
    </>
  );
}
