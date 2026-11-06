import { ShoppingCart } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";

export default function Cart() {
  return (
    <>
      <PageHeader title="Cart" />
      <main>
        <EmptyState title="Your cart is empty" icon={<ShoppingCart size={48} strokeWidth={1.4} />}>
          Items you add when placing an order will show up here.
        </EmptyState>
      </main>
    </>
  );
}
