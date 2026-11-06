import { ArrowLeftRight, Store } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { accounts } from "@/lib/data";

export default function Accounts() {
  return (
    <>
      <PageHeader title="Accounts" />
      <main className="stack" style={{ gap: 14 }}>
        <button className="card-link" style={{ width: "100%", textAlign: "left" }}>
          <span className="avatar round accent"><ArrowLeftRight size={22} /></span>
          <span className="grow">Transfer between accounts</span>
        </button>
        {accounts.map((a) => (
          <div key={a.id} className="account" style={{ margin: 0 }}>
            <span className="mark"><Store size={26} /></span>
            <span className="meta">
              <span className="sub" style={{ display: "block" }}>{a.type}</span>
              <span className="name">{a.name}</span>
            </span>
          </div>
        ))}
        <button className="btn primary" style={{ marginTop: 10 }}>Add account</button>
      </main>
    </>
  );
}
