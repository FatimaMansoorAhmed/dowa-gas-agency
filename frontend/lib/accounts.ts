import type { AccountType, PaymentAccount } from "./types";

// The 3 fixed Liquidity Hub buckets Cash Management and the Payments page
// both read/write through. Every page must resolve these the same way —
// via account_type first, matching name second — so there is only ever
// one real PaymentAccount row (and one balance) per bucket. Backend
// mirror: app/utils.py's BUCKET_ACCOUNT_LABELS / get_or_create_bucket_account.
export type BucketType = Extract<AccountType, "office_cash" | "owner_home" | "dowa_account">;

export const BUCKET_ACCOUNTS: { type: BucketType; label: string }[] = [
  { type: "office_cash", label: "Office Cash" },
  { type: "owner_home", label: "Home Cash" },
  { type: "dowa_account", label: "Dowa Account" },
];

export function findBucketAccount(accounts: PaymentAccount[], type: BucketType): PaymentAccount | undefined {
  const label = BUCKET_ACCOUNTS.find((b) => b.type === type)?.label || type;
  return (
    accounts.find((a) => a.account_type === type) ||
    accounts.find((a) => a.name.toLowerCase() === label.toLowerCase())
  );
}

export function bucketBalance(accounts: PaymentAccount[], type: BucketType): number {
  const account = findBucketAccount(accounts, type);
  return account ? parseFloat(account.current_balance) : 0;
}
