"use client";

import { useState } from "react";
import { Trash2, Tablet } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { devices as initial } from "@/lib/data";

export default function Devices() {
  const [devices, setDevices] = useState(initial);
  return (
    <>
      <PageHeader title="My devices" />
      <main>
        {devices.length === 0 && <p className="center-note" style={{ paddingTop: 40 }}>No devices linked yet.</p>}
        <ul className="list" style={{ padding: "var(--gutter)", gap: 10 }}>
          {devices.map((d) => (
            <li key={d.id} className="account" style={{ margin: 0 }}>
              <span className="mark"><Tablet size={28} /></span>
              <span className="meta">
                <span className="name" style={{ display: "block" }}>{d.name}</span>
                <span className="sub">{d.serial}</span>
              </span>
              <button
                className="icon-btn trash"
                aria-label={`Remove ${d.name}`}
                onClick={() => setDevices((p) => p.filter((x) => x.id !== d.id))}
              >
                <Trash2 size={20} />
              </button>
            </li>
          ))}
        </ul>
      </main>
      <div className="dock">
        <button className="btn primary">Link new device</button>
      </div>
    </>
  );
}
