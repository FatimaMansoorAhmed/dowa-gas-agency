import { pkr } from "./format";
import type { Company, Customer, Employee, ShopSupplyCustomer } from "./types";

// Delete Customer / Company / Employee — the confirm text always states the
// exact standing that is about to be written off, worded by its real state:
// a positive balance is money OWED, a negative one (or advance credit) is
// money the business is HOLDING, and they must never share one generic
// sentence. `t` is the caller's react-i18next translate function.
type T = (key: string, options?: Record<string, unknown>) => string;

function finish(t: T, key: string, name: string, parts: string[]): string {
  const details = parts.length ? parts.join(" ") : t("deleteEntity.nothingOutstanding");
  return t(key, { name, details });
}

export function customerDeleteMessage(t: T, c: Customer): string {
  const bal = parseFloat(c.current_balance) || 0;
  const credit = parseFloat(c.account_credit) || 0;
  const filled = (parseFloat(c.cylinder_balance_118) || 0) + (parseFloat(c.cylinder_balance_454) || 0);
  const empties = (parseFloat(c.empty_cylinders_118) || 0) + (parseFloat(c.empty_cylinders_454) || 0);
  const parts: string[] = [];
  if (bal > 0) parts.push(t("deleteEntity.customerOwes", { amount: pkr(bal) }));
  if (bal < 0) parts.push(t("deleteEntity.holdsAdvance", { amount: pkr(-bal) }));
  if (credit > 0) parts.push(t("deleteEntity.holdsCredit", { amount: pkr(credit) }));
  if (filled > 0) parts.push(t("deleteEntity.holdsFilled", { count: filled }));
  if (empties > 0) parts.push(t("deleteEntity.holdsEmpties", { count: empties }));
  return finish(t, "deleteEntity.confirmCustomer", c.name, parts);
}

export function companyDeleteMessage(t: T, c: Company): string {
  const bal = parseFloat(c.current_balance) || 0;
  const credit = parseFloat(c.account_credit) || 0;
  const parts: string[] = [];
  if (bal > 0) parts.push(t("deleteEntity.plantOwed", { amount: pkr(bal) }));
  if (bal < 0) parts.push(t("deleteEntity.plantAdvance", { amount: pkr(-bal) }));
  if (credit > 0) parts.push(t("deleteEntity.plantHoldsCredit", { amount: pkr(credit) }));
  return t("deleteEntity.confirmCompany", {
    name: c.name,
    details: parts.length ? parts.join(" ") : t("deleteEntity.nothingOutstanding"),
  });
}

export function employeeDeleteMessage(t: T, e: Employee): string {
  const bal = parseFloat(e.current_balance) || 0;
  const parts: string[] = [];
  if (bal > 0) parts.push(t("deleteEntity.salaryDue", { amount: pkr(bal) }));
  if (bal < 0) parts.push(t("deleteEntity.salaryAhead", { amount: pkr(-bal) }));
  return finish(t, "deleteEntity.confirmEmployee", e.name, parts);
}

export function supplyCustomerDeleteMessage(t: T, c: ShopSupplyCustomer): string {
  const bal = parseFloat(c.current_balance) || 0;
  const parts: string[] = [];
  if (bal > 0) parts.push(t("deleteEntity.supplyOwes", { amount: pkr(bal) }));
  if (bal < 0) parts.push(t("deleteEntity.supplyAdvance", { amount: pkr(-bal) }));
  return finish(t, "deleteEntity.confirmSupplyCustomer", c.name, parts);
}
