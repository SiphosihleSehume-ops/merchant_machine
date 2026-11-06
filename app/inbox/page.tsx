"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import Tabs from "@/components/Tabs";
import { messages } from "@/lib/data";

type Tab = "all" | "features" | "promotions";

export default function Inbox() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("all");
  const shown = messages.filter((m) => tab === "all" || m.kind === tab);
  return (
    <>
      <header className="topbar" style={{ gridTemplateColumns: "48px 1fr" }}>
        <button className="icon-btn" onClick={() => router.back()} aria-label="Back">
          <ArrowLeft size={24} />
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>Messages</h1>
      </header>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "all", label: "All" },
          { id: "features", label: "Features" },
          { id: "promotions", label: "Promotions" },
        ]}
      />
      <main>
        {shown.map((m) => (
          <article key={m.id} className="message">
            <div className="copy">
              <h2>{m.title}</h2>
              <p>{m.body}</p>
            </div>
            <div className="banner">
              <span className="headline">{m.banner.headline}</span>
              <span className="sub">{m.banner.sub}</span>
            </div>
            <div className="foot">
              {m.terms ? <button className="link-btn">View T&amp;Cs</button> : <span />}
              <span>{m.date}</span>
            </div>
          </article>
        ))}
      </main>
    </>
  );
}
