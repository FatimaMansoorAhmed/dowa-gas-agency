"use client";
import { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, PlusCircle, Radio, Users, ChevronRight, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { CylinderStripe } from "./ui";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutGrid },
  { href: "/new-rate", label: "New Rate Entry", icon: PlusCircle },
  { href: "/rate-dashboard", label: "Rate Dashboard", icon: Radio },
  { href: "/customers", label: "Customers", icon: Users },
];

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  return (
    <div className="flex">
      <div className="w-[216px] bg-ink min-h-screen flex-shrink-0 sticky top-0 h-screen">
        {/* Sidebar Header with Logo Image */}
        <div className="flex items-center gap-2.5 px-5 pt-[22px] pb-[18px]">
          <Image
            src="/logo.png"
            alt="Dowa Gas Logo"
            width={32}
            height={32}
            className="h-8 w-8 object-contain"
            priority
          />
          <div>
            <div className="font-display font-bold text-[14.5px] text-white">DOWA GAS</div>
            <div className="font-mono text-[9.5px] text-[#7FA9AA] tracking-wide">AGENCY · KHI</div>
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
                  className={`font-body text-[13px] ${
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

        <div className="absolute bottom-0 w-[216px] px-5 py-3.5 border-t border-white/10">
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
            <div className="font-body text-[13px] text-steel">
              Phase 2 — <span className="text-ink font-medium">Rates &amp; Customers</span>, live from Postgres.
            </div>
            <div className="font-mono text-[11.5px] text-steel bg-paper px-3 py-1.5 rounded-full border border-hairline">
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