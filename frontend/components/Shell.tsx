"use client";
import { ReactNode } from "react";
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
  CreditCard
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { CylinderStripe } from "./ui";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutGrid },
  { href: "/new-rate", label: "New Rate Entry", icon: PlusCircle },
  { href: "/rate-dashboard", label: "Rate Dashboard", icon: Radio },
  { href: "/purchases", label: "Purchases", icon: Truck },
  { href: "/new-sale", label: "New Sale", icon: ReceiptText },
  { href: "/unified-sale", label: "Unified Sale", icon: ShoppingBag }, // <-- Naya link yahan add kiya gaya hai
  { href: "/payments", label: "Payments", icon: CreditCard },
  { href: "/customer-ledger", label: "Customer Ledger", icon: BookOpenText },
  // { href: "/cylinder-ledger", label: "Cylinder Ledger", icon: CircleGauge },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/expenses", label: "Expenses", icon: Wallet },
];

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  return (
    <div className="flex">
      <div className="w-[220px] bg-ink min-h-screen flex-shrink-0 sticky top-0 h-screen">
        {/* Sidebar Header with White Badge Container */}
        <div className="flex items-center gap-3 px-4 pt-[20px] pb-[18px]">
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
          <div>
            <div className="font-display font-bold text-[15px] text-white leading-tight">DOWA GAS</div>
            <div className="font-mono text-[9.5px] text-[#7FA9AA] tracking-wider mt-0.5">AGENCY · KHI</div>
          </div>
        </div>

        <div className="px-3">
          {NAV.map((n) => {
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

        <div className="absolute bottom-0 w-[220px] px-5 py-3.5 border-t border-white/10">
          <div className="flex justify-between items-center">
            <div>
              <div className="font-body text-[12.5px] text-white font-semibold">{user?.name}</div>
              <div className="font-mono text-[9.5px] text-[#7FA9AA]">{user?.role}</div>
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

      <div className="flex-1 min-w-0">
        <div className="bg-panel border-b border-hairline">
          <div className="flex items-center justify-between px-8 py-3.5">
            <div className="font-body text-[13.5px] font-medium text-slate-800">
              Phase 2 — <span className="text-slate-900 font-bold">Rates &amp; Customers</span>, live from Postgres.
            </div>
            <div className="font-mono text-[12px] font-semibold text-slate-800 bg-paper px-3.5 py-1.5 rounded-full border border-hairline">
              {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
            </div>
          </div>
          <CylinderStripe />
        </div>
        <div className="px-8 pt-7 pb-16 max-w-[1280px]">{children}</div>
      </div>
    </div>
  );
}