"use client";

import { useMemo, useState } from "react";
import { Search, ThumbsUp, X } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import Tabs from "@/components/Tabs";
import { suppliers } from "@/lib/data";

type Tab = "name" | "distance" | "favourites";

const initials = (name: string) =>
  name
    .replace(/[^A-Za-z\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

export default function Suppliers() {
  const [tab, setTab] = useState<Tab>("name");
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");

  const toggle = (id: string) =>
    setFavs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const list = useMemo(() => {
    let l = [...suppliers];
    if (tab === "name") l.sort((a, b) => a.name.localeCompare(b.name));
    if (tab === "distance") l.sort((a, b) => a.km - b.km);
    if (tab === "favourites") l = l.filter((s) => favs.has(s.id));
    const q = query.trim().toLowerCase();
    return q ? l.filter((s) => s.name.toLowerCase().includes(q)) : l;
  }, [tab, favs, query]);

  return (
    <>
      <PageHeader />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "name", label: "Sort by name" },
          { id: "distance", label: "Distance" },
          { id: "favourites", label: "Favourites" },
        ]}
      />
      <main className="pad-bottom">
        {list.length === 0 ? (
          <p className="center-note" style={{ paddingTop: 40 }}>
            {tab === "favourites" && !query
              ? "Add suppliers to your favourites to see them here."
              : "No suppliers match your search."}
          </p>
        ) : (
          <ul className="list">
            {list.map((s) => (
              <li key={s.id} className="row">
                <span className="avatar">{initials(s.name)}</span>
                <span className="grow">
                  <span className="name" style={{ display: "block" }}>{s.name}</span>
                  {tab === "distance" && <span className="sub">{s.km}km</span>}
                </span>
                <button
                  className="like"
                  aria-pressed={favs.has(s.id)}
                  aria-label={`Favourite ${s.name}`}
                  onClick={() => toggle(s.id)}
                >
                  <ThumbsUp size={22} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      <div className="dock">
        {searching ? (
          <div className="search-field">
            <Search size={20} color="var(--accent)" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search suppliers"
              aria-label="Search suppliers"
            />
            <button
              className="icon-btn"
              style={{ margin: 0 }}
              aria-label="Close search"
              onClick={() => {
                setSearching(false);
                setQuery("");
              }}
            >
              <X size={20} />
            </button>
          </div>
        ) : (
          <button className="btn primary" onClick={() => setSearching(true)} style={{ textTransform: "none", letterSpacing: 0, fontSize: 17, fontWeight: 600 }}>
            <Search size={20} /> Search…
          </button>
        )}
      </div>
    </>
  );
}
