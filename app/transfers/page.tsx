import Link from "next/link";
import { Pencil, Plus, QrCode } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { friends } from "@/lib/data";

export default function Transfers() {
  return (
    <>
      <PageHeader
        title="Transfer"
        action={
          <button className="icon-btn filled" aria-label="Edit friends">
            <Pencil size={18} />
          </button>
        }
      />
      <main>
        <div className="tile-grid padded" style={{ paddingBottom: 14 }}>
          {friends.map((f) => (
            <button key={f.id} className="tile sentence" style={{ minHeight: 104 }}>
              <span className="avatar round light">{f.name[0]}</span>
              <span className="tile-label" style={{ fontSize: 14, fontWeight: 600 }}>{f.name}</span>
            </button>
          ))}
        </div>
        <div className="btn-row">
          <button className="btn primary">
            <Plus size={20} /> Add friend
          </button>
          <Link href="/share-code" className="btn outline">
            <QrCode size={20} /> Share code
          </Link>
        </div>
      </main>
    </>
  );
}
