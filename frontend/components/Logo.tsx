import Image from "next/image";
import Link from "next/link";

export default function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <Image
        src="/logo.png" // Save your file in the public/ folder as public/logo.png
        alt="Company Logo"
        width={32}
        height={32}
        className="h-8 w-8 object-contain"
        priority
      />
      <span className="font-display font-bold text-lg text-ink tracking-tight">
        LPG Traders
      </span>
    </Link>
  );
}