export const pkr = (n: number | string) => {
  const num = typeof n === "string" ? parseFloat(n) : n;
  const neg = num < 0;
  const v = Math.abs(Math.round(num || 0));
  return (neg ? "-" : "") + "Rs " + v.toLocaleString("en-US");
};

export const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

export const monthKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
