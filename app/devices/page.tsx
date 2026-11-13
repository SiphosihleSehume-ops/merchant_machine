"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Tablet, Trash2 } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { AUTH_DISABLED } from "@/lib/config";

type Device = { id: string; name: string; serial: string; linkedAt: string };

export default function Devices() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  const load = useCallback(async () => {
    try {
      setDevices(await api<Device[]>("/devices"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load devices");
    }
  }, []);

  useEffect(() => {
    if (!AUTH_DISABLED) load();
  }, [load]);

  async function remove(d: Device) {
    if (!window.confirm(`Unlink ${d.name}?`)) return;
    try {
      await api(`/devices/${d.id}`, { method: "DELETE" });
      setDevices((list) => list?.filter((x) => x.id !== d.id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlink device");
    }
  }

  // Shared demo account (test mode) can't link devices
  if (AUTH_DISABLED) {
    return (
      <>
        <PageHeader title="My devices" />
        <main className="stack">
          <div className="alert warn">
            <strong>Registered account required.</strong> Devices can only be linked to a registered, signed-in
            account. Turn test mode off (set <code>AUTH_DISABLED</code> and <code>NEXT_PUBLIC_AUTH_DISABLED</code> to
            false), sign in, then come back here.
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <PageHeader title="My devices" />
      <main>
        {error && <div className="stack" style={{ paddingBottom: 0 }}><div className="alert bad" role="alert">{error}</div></div>}
        {devices === null && !error && <p className="center-note" style={{ paddingTop: 40 }}>Loading devices…</p>}
        {devices?.length === 0 && <p className="center-note" style={{ paddingTop: 40 }}>No devices linked yet.</p>}
        <ul className="list" style={{ padding: "var(--gutter)", gap: 10 }}>
          {devices?.map((d) => (
            <li key={d.id} className="account" style={{ margin: 0 }}>
              <span className="mark"><Tablet size={28} /></span>
              <Link href={`/devices/${d.id}`} className="meta" style={{ flex: 1 }}>
                <span className="name" style={{ display: "block" }}>{d.name}</span>
                <span className="sub">{d.serial} · Send crypto</span>
              </Link>
              <Link href={`/devices/${d.id}`} className="icon-btn" aria-label={`Open ${d.name}`}>
                <ChevronRight size={20} />
              </Link>
              <button className="icon-btn trash" aria-label={`Remove ${d.name}`} onClick={() => remove(d)}>
                <Trash2 size={20} />
              </button>
            </li>
          ))}
        </ul>
      </main>
      <div className="dock">
        <button className="btn primary" onClick={() => setLinking(true)}>Link new device</button>
      </div>

      {linking && (
        <LinkDeviceModal
          onClose={() => setLinking(false)}
          onLinked={(d) => {
            setLinking(false);
            setDevices((list) => [...(list ?? []), d]);
          }}
        />
      )}
    </>
  );
}

function LinkDeviceModal({ onClose, onLinked }: { onClose: () => void; onLinked: (d: Device) => void }) {
  const [name, setName] = useState("");
  const [serial, setSerial] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim().length >= 2 && /^[A-Za-z0-9-]{6,32}$/.test(serial.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLinked(await api<Device>("/devices", { body: { name: name.trim(), serial: serial.trim() } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link device");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="link-title" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 id="link-title">Link a device</h2>
        <div className="form-field">
          <label htmlFor="device-name">Device name</label>
          <input id="device-name" className="text-input" placeholder="Front counter card machine" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="device-serial">Serial number</label>
          <input
            id="device-serial"
            className="text-input"
            placeholder="40161974"
            maxLength={32}
            spellCheck={false}
            value={serial}
            onChange={(e) => setSerial(e.target.value.replace(/[^A-Za-z0-9-]/g, ""))}
          />
          <span className="muted" style={{ fontSize: 13 }}>Printed on the back of the device. 6 to 32 letters or digits.</span>
        </div>
        {error && <div className="alert bad" role="alert">{error}</div>}
        <button className="btn primary" type="submit" disabled={!valid || busy}>{busy ? "Linking…" : "Link device"}</button>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </div>
  );
}
