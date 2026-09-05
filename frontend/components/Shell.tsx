"use client";
import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutGrid,
  PlusCircle,
  Radio,
  Users,
  ReceiptText,
  BookOpenText,
  Truck,
  Wallet,
  CircleGauge,
  LogOut,
  ChevronRight,
  ShoppingBag, // Unified Sale ke liye naya icon
  CreditCard,
  PackageOpen,
  Banknote,
  CalendarClock,
  FileStack,
  Store,
  UserCog,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { CylinderStripe } from "./ui";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutGrid },
  // { href: "/new-rate", label: "New Rate Entry", icon: PlusCircle },
  { href: "/rate-dashboard", label: "Rate Dashboard", icon: Radio },
  { href: "/unified-sale", label: " Sale", icon: ShoppingBag }, // <-- Naya link yahan add kiya gaya hai
   { href: "/payments", label: "Payments", icon: CreditCard },
  { href: "/purchases", label: "Purchases", icon: Truck },
  // { href: "/new-sale", label: "New Sale", icon: ReceiptText },
  
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/customer-ledger", label: "Customer Ledger", icon: BookOpenText },
  // { href: "/cylinder-ledger", label: "Cylinder Ledger", icon: CircleGauge },
  { href: "/empty-cylinders", label: "Empty Cylinders", icon: PackageOpen },
 
  { href: "/expenses", label: "Expenses", icon: Wallet },
   { href: "/cash-managment", label: "Cash Book", icon: Wallet },
  { href: "/owner-capital", label: "Owner Investment", icon: Banknote },
  { href: "/shops", label: "Shops", icon: Store },
  { href: "/daily-activity", label: "Daily Activity", icon: CalendarClock },
  { href: "/reports", label: "Reports", icon: FileStack },

];

// Owner-only — cosmetic gating (real enforcement is the backend's
// require_owner dependency on /users/*). Kept separate from NAV rather
// than baked in since it's the only role-conditional entry.
const OWNER_NAV = { href: "/users", label: "User Management", icon: UserCog };

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close the mobile drawer whenever the route changes, so navigating to a
  // link doesn't leave the drawer sitting open over the new page.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  const navLinks = user?.role === "owner" ? [...NAV, OWNER_NAV] : NAV;

  return (
    <div className="flex">
      {/* Mobile top bar — hamburger trigger, hidden at lg+ where the sidebar is always visible */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-40 flex items-center gap-3 bg-ink px-4 py-3 shadow-sm">
        <button
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open menu"
          className="bg-transparent border-none cursor-pointer shrink-0 p-1 -ml-1"
        >
          <Menu size={22} color="#FFFFFF" />
        </button>
        <div className="w-8 h-8 rounded-full bg-white p-1 flex items-center justify-center shrink-0 overflow-hidden shadow-sm">
          <Image src="/logo.png" alt="Dowa Gas Logo" width={32} height={32} className="w-full h-full object-contain scale-110" priority />
        </div>
        <div className="font-display font-bold text-[13.5px] text-white leading-tight">DOWA GAS</div>
      </div>

      {/* Backdrop for the mobile drawer */}
      {mobileNavOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={`w-[220px] bg-ink min-h-screen h-screen flex-shrink-0 flex flex-col fixed lg:sticky top-0 left-0 z-50 transition-transform duration-200 ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0`}
      >
        {/* Sidebar Header with White Badge Container */}
        <div className="flex items-center gap-3 px-4 pt-[20px] pb-[18px] shrink-0">
          {/* White Circular Background Wrapper for Logo */}
          <div className="w-10 h-10 rounded-full bg-white p-1 flex items-center justify-center shrink-0 overflow-hidden shadow-sm">
            <Image
              src="/logo.png"
              alt="Dowa Gas Logo"
              width={40}
              height={40}
              className="w-full h-full object-contain scale-110"
              priority
            />
          </div>
          <div className="flex-1">
            <div className="font-display font-bold text-[15px] text-white leading-tight">DOWA GAS</div>
            <div className="font-mono text-[9.5px] text-[#7FA9AA] tracking-wider mt-0.5">AGENCY · KHI</div>
          </div>
          <button
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu"
            className="lg:hidden bg-transparent border-none cursor-pointer p-1"
          >
            <X size={18} color="#8A98A3" />
          </button>
        </div>

        <div className="px-3 flex-1 min-h-0 overflow-y-auto">
          {navLinks.map((n) => {
            const Icon = n.icon;
            const active = pathname === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-2.5 px-3 py-2.5 mb-0.5 rounded-md ${
                  active
                    ? "bg-[rgba(15,139,141,0.18)] border-l-[3px] border-teal"
                    : "border-l-[3px] border-transparent"
                }`}
              >
                <Icon size={16} color={active ? "#0F8B8D" : "#8A98A3"} strokeWidth={2} />
                <span
                  className={`font-body text-[13.5px] ${
                    active ? "font-semibold text-white" : "font-normal text-[#B7C0C7]"
                  }`}
                >
                  {n.label}
                </span>
                {active && <ChevronRight size={13} color="#0F8B8D" className="ml-auto" />}
              </Link>
            );
          })}
        </div>

        <div className="shrink-0 w-[220px] px-5 py-3.5 border-t border-white/10">
          <div className="flex justify-between items-center">
            <div>
              <div className="font-body text-[12.5px] text-white font-semibold">{user?.name}</div>
              <div className="font-mono text-[9.5px] text-[#7FA9AA]">{user?.role === "owner" ? "Owner" : "Staff"}</div>
            </div>
            <button
              onClick={() => {
                logout();
                router.push("/login");
              }}
              className="bg-transparent border-none cursor-pointer"
              aria-label="Log out"
            >
              <LogOut size={14} color="#8A98A3" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-w-0 pt-14 lg:pt-0">
        <div className="bg-panel border-b border-hairline">
          <div className="flex items-center justify-between px-4 sm:px-6 lg:px-8 py-3.5 flex-wrap gap-2">
            <div className="font-body text-[13.5px] font-medium text-slate-800">
              Dowa gas Agency — <span className="text-slate-900 font-bold">Rates &amp; Customers</span>, Purchases , Sales.
            </div>
            <div className="font-mono text-[12px] font-semibold text-slate-800 bg-paper px-3.5 py-1.5 rounded-full border border-hairline">
              {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Karachi" })}
            </div>
          </div>
          <CylinderStripe />
        </div>
        <div className="px-4 sm:px-6 lg:px-8 pt-7 pb-16 max-w-[1280px]">{children}</div>
      </div>
    </div>
  );
}