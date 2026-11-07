import Link from "next/link";
import { Receipt, ShoppingBasket } from "lucide-react";
import PageHeader from "@/components/PageHeader";

export default function Orders() {
  return (
    <>
      <PageHeader title="Orders" />
      <main>
        <div className="tile-grid padded">
          <Link href="/suppliers" className="tile sentence" style={{ minHeight: 120 }}>
            <ShoppingBasket className="tile-icon" size={34} strokeWidth={1.6} />
            <span className="tile-label">Place order</span>
          </Link>
          <Link href="/history" className="tile sentence" style={{ minHeight: 120 }}>
            <Receipt className="tile-icon" size={34} strokeWidth={1.6} />
            <span className="tile-label">History</span>
          </Link>
        </div>
      </main>
    </>
  );
}
