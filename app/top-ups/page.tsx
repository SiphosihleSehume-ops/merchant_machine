import { Smartphone, Wifi, Zap, Ticket, Tv, Droplets, Gift } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { topUps } from "@/lib/data";

const icons = { airtime: Smartphone, data: Wifi, electricity: Zap, vouchers: Ticket, tv: Tv, water: Droplets, gift: Gift };

export default function TopUps() {
  return (
    <>
      <PageHeader title="Top ups" />
      <main>
        <div className="tile-grid padded">
          {topUps.map((t) => {
            const Icon = icons[t.id];
            return (
              <button key={t.id} className="tile sentence" style={{ minHeight: 120 }}>
                <span className="avatar round accent" style={{ width: 52, height: 52 }}>
                  <Icon size={24} />
                </span>
                <span className="tile-label">{t.name}</span>
              </button>
            );
          })}
        </div>
      </main>
    </>
  );
}
