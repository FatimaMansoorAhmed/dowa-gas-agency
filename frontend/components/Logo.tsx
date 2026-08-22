import Image from "next/image";
import Link from "next/link";

export default function Logo() {
  return (
    <Link href="/" className="flex items-center gap-3 group">
      {/* White Circular Badge Container */}
      <div className="w-10 h-10 rounded-full bg-white p-1 flex items-center justify-center shrink-0 overflow-hidden shadow-sm border border-slate-200">
        <Image
          src="/logo.png"
          alt="DOWA Gas Agency"
          width={40}
          height={40}
          className="w-full h-full object-contain scale-110"
          priority
        />
      </div>

      {/* Agency Title */}
      <div className="flex flex-col">
        <span className="font-display font-bold text-[15px] text-white tracking-tight leading-tight group-hover:text-teal-400 transition-colors">
          DOWA GAS
        </span>
        <span className="font-mono text-[10px] text-slate-400 uppercase tracking-widest">
          AGENCY • KHI
        </span>
      </div>
    </Link>
  );
}