import Link from "next/link";
import {
  Award, Star, Store, MapPin, FileUp, Smartphone, CreditCard, ChevronRight, Pencil,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { merchant } from "@/lib/data";

const items = [
  { label: "Rewards partners", Icon: Award, href: "#" },
  { label: "My shop", Icon: Store, href: "#" },
  { label: "My address", Icon: MapPin, href: "#" },
  { label: "Upload documents", Icon: FileUp, href: "#" },
  { label: "My devices", Icon: Smartphone, href: "/devices" },
  { label: "My cards", Icon: CreditCard, href: "#" },
];

export default function Profile() {
  return (
    <>
      <PageHeader
        title="My profile"
        action={
          <button className="icon-btn filled" aria-label="Edit profile">
            <Pencil size={18} />
          </button>
        }
      />
      <main>
        <section className="rewards">
          <div className="top">
            <span className="eyebrow">My rewards level</span>
            <div className="stars" aria-label={`Level ${merchant.rewardsLevel} of 5`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} size={34} className={n <= merchant.rewardsLevel ? "on" : ""} />
              ))}
            </div>
            <p className="hint">
              <strong>How do I get to level 2?</strong>
              Grow your sales and money transfers, and accept QR payments.
            </p>
          </div>
          <div className="bottom">
            <Award size={40} color="var(--accent)" strokeWidth={1.5} />
            <div>
              <div className="points">{merchant.rewardsBalance.toFixed(2)}</div>
              <div className="points-sub">Reward points available this week at participating partners</div>
            </div>
          </div>
        </section>

        <div className="stack" style={{ paddingTop: 0, gap: 10 }}>
          {items.map(({ label, Icon, href }) => (
            <Link key={label} href={href} className="card-link">
              <Icon size={26} color="var(--accent)" strokeWidth={1.7} />
              <span className="grow">{label}</span>
              <ChevronRight size={20} />
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
