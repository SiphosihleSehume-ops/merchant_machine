import Link from "next/link";
import { Menu, User, ScanLine, Mail, QrCode } from "lucide-react";

export default function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      <Link href="/menu" className="nav-item">
        <Menu size={26} />
        <span>Menu</span>
      </Link>
      <Link href="/profile" className="nav-item">
        <User size={26} />
        <span>Profile</span>
      </Link>
      <Link href="/scan" className="nav-fab" aria-label="Scan">
        <ScanLine size={30} strokeWidth={2.25} />
      </Link>
      <Link href="/inbox" className="nav-item">
        <span className="nav-icon-wrap">
          <Mail size={26} />
          <span className="nav-badge">1</span>
        </span>
        <span>Inbox</span>
      </Link>
      <Link href="/share-code" className="nav-item">
        <QrCode size={26} />
        <span>Get paid</span>
      </Link>
    </nav>
  );
}
