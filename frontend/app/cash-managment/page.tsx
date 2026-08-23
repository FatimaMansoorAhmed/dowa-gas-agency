// "use client";

// import React, { useState } from "react";

// // Types
// type AccountType = "office_cash" | "home_cash" | "dowa_account";
// type PlantType = "plant_a" | "plant_b" | "plant_c";

// interface DrawingRecord {
//   id: string;
//   customerName: string;
//   saleId: string;
//   date: string;
//   sourceAccount: string;
//   amount: number;
// }

// export default function CashManagementPage() {
//   // 1. Liquidity Hub State
//   const [balances, setBalances] = useState<Record<AccountType, number>>({
//     office_cash: 150000,
//     home_cash: 50000,
//     dowa_account: 500000,
//   });

//   // Transfer Form State
//   const [transfer, setTransfer] = useState<{ from: AccountType; to: AccountType; amount: string }>({
//     from: "office_cash",
//     to: "dowa_account",
//     amount: "",
//   });

//   // 2. Plant Payment State
//   const [plantPay, setPlantPay] = useState<{ source: AccountType; plant: PlantType; amount: string }>({
//     source: "office_cash",
//     plant: "plant_a",
//     amount: "",
//   });

//   // 3. Drawings Ledger Mock Data
//   const [drawings] = useState<DrawingRecord[]>([
//     { id: "1", customerName: "Ali Traders", saleId: "SL-1002", date: "2026-03-28", sourceAccount: "Office Cash", amount: 12000 },
//     { id: "2", customerName: "Khan Gas", saleId: "SL-1008", date: "2026-03-29", sourceAccount: "Dowa Account", amount: 25000 },
//   ]);

//   // Handlers
//   const handleTransfer = (e: React.FormEvent) => {
//     e.preventDefault();
//     const amt = Number(transfer.amount);
//     if (!amt || transfer.from === transfer.to || balances[transfer.from] < amt) return;

//     setBalances((prev) => ({
//       ...prev,
//       [transfer.from]: prev[transfer.from] - amt,
//       [transfer.to]: prev[transfer.to] + amt,
//     }));
//     setTransfer((prev) => ({ ...prev, amount: "" }));
//   };

//   const handlePlantPayment = (e: React.FormEvent) => {
//     e.preventDefault();
//     const amt = Number(plantPay.amount);
//     if (!amt || balances[plantPay.source] < amt) return;

//     setBalances((prev) => ({
//       ...prev,
//       [plantPay.source]: prev[plantPay.source] - amt,
//     }));
//     setPlantPay((prev) => ({ ...prev, amount: "" }));
//   };

//   const totalDrawings = drawings.reduce((acc, curr) => acc + curr.amount, 0);

//   return (
//     <div className="p-6 max-w-7xl mx-auto space-y-8 bg-slate-50 min-h-screen text-slate-800">
//       <h1 className="text-2xl font-bold">Cash Management & Liquidity</h1>

//       {/* SECTION 1: LIQUIDITY HUB */}
//       <section className="space-y-4">
//         <h2 className="text-lg font-semibold text-slate-700">1. Liquidity Hub</h2>
//         <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
//           {(Object.keys(balances) as AccountType[]).map((acc) => (
//             <div key={acc} className="p-4 bg-white rounded-lg border border-slate-200 shadow-sm">
//               <p className="text-sm text-slate-500 capitalize">{acc.replace("_", " ")}</p>
//               <p className="text-2xl font-bold text-slate-900 mt-1">
//                 PKR {balances[acc].toLocaleString()}
//               </p>
//             </div>
//           ))}
//         </div>

//         {/* Transfer Form */}
//         <form onSubmit={handleTransfer} className="p-4 bg-white rounded-lg border border-slate-200 flex flex-wrap gap-4 items-end">
//           <div>
//             <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
//             <select
//               value={transfer.from}
//               onChange={(e) => setTransfer({ ...transfer, from: e.target.value as AccountType })}
//               className="p-2 border rounded text-sm bg-slate-50"
//             >
//               <option value="office_cash">Office Cash</option>
//               <option value="home_cash">Home Cash</option>
//               <option value="dowa_account">Dowa Account</option>
//             </select>
//           </div>
//           <div>
//             <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
//             <select
//               value={transfer.to}
//               onChange={(e) => setTransfer({ ...transfer, to: e.target.value as AccountType })}
//               className="p-2 border rounded text-sm bg-slate-50"
//             >
//               <option value="office_cash">Office Cash</option>
//               <option value="home_cash">Home Cash</option>
//               <option value="dowa_account">Dowa Account</option>
//             </select>
//           </div>
//           <div>
//             <label className="block text-xs font-medium text-slate-600 mb-1">Amount (PKR)</label>
//             <input
//               type="number"
//               value={transfer.amount}
//               onChange={(e) => setTransfer({ ...transfer, amount: e.target.value })}
//               placeholder="e.g. 50000"
//               className="p-2 border rounded text-sm bg-slate-50"
//             />
//           </div>
//           <button type="submit" className="px-4 py-2 bg-slate-900 text-white rounded text-sm font-medium hover:bg-slate-800">
//             Transfer
//           </button>
//         </form>
//       </section>

//       {/* SECTION 2: PLANT SUPPLIER PAYMENTS */}
//       <section className="space-y-4">
//         <h2 className="text-lg font-semibold text-slate-700">2. Plant Supplier Payment</h2>
//         <form onSubmit={handlePlantPayment} className="p-4 bg-white rounded-lg border border-slate-200 flex flex-wrap gap-4 items-end">
//           <div>
//             <label className="block text-xs font-medium text-slate-600 mb-1">Source Account</label>
//             <select
//               value={plantPay.source}
//               onChange={(e) => setPlantPay({ ...plantPay, source: e.target.value as AccountType })}
//               className="p-2 border rounded text-sm bg-slate-50"
//             >
//               <option value="office_cash">Office Cash</option>
//               <option value="dowa_account">Dowa Account</option>
//             </select>
//           </div>
//           <div>
//             <label className="block text-xs font-medium text-slate-600 mb-1">Select Plant</label>
//             <select
//               value={plantPay.plant}
//               onChange={(e) => setPlantPay({ ...plantPay, plant: e.target.value as PlantType })}
//               className="p-2 border rounded text-sm bg-slate-50"
//             >
//               <option value="plant_a">Plant A</option>
//               <option value="plant_b">Plant B</option>
//               <option value="plant_c">Plant C</option>
//             </select>
//           </div>
//           <div>
//             <label className="block text-xs font-medium text-slate-600 mb-1">Amount (PKR)</label>
//             <input
//               type="number"
//               value={plantPay.amount}
//               onChange={(e) => setPlantPay({ ...plantPay, amount: e.target.value })}
//               placeholder="e.g. 100000"
//               className="p-2 border rounded text-sm bg-slate-50"
//             />
//           </div>
//           <button type="submit" className="px-4 py-2 bg-emerald-700 text-white rounded text-sm font-medium hover:bg-emerald-800">
//             Clear Payable
//           </button>
//         </form>
//       </section>

//       {/* SECTION 3: OWNER DRAWINGS LEDGER */}
//       <section className="space-y-4">
//         <h2 className="text-lg font-semibold text-slate-700">3. Owner Drawings Audit Ledger</h2>
        
//         {/* KPI Summary Card */}
//         <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg w-full md:w-1/3">
//           <p className="text-sm text-amber-800 font-medium">Total Owner Drawings</p>
//           <p className="text-2xl font-bold text-amber-950 mt-1">
//             PKR {totalDrawings.toLocaleString()}
//           </p>
//         </div>

//         {/* Ledger Table */}
//         <div className="overflow-x-auto bg-white rounded-lg border border-slate-200 shadow-sm">
//           <table className="w-full text-left text-sm text-slate-600">
//             <thead className="bg-slate-100 text-slate-700 uppercase text-xs">
//               <tr>
//                 <th className="p-3">Customer / Sale ID</th>
//                 <th className="p-3">Date</th>
//                 <th className="p-3">Source Account</th>
//                 <th className="p-3 text-right">Amount Drawn</th>
//               </tr>
//             </thead>
//             <tbody className="divide-y divide-slate-100">
//               {drawings.map((row) => (
//                 <tr key={row.id} className="hover:bg-slate-50">
//                   <td className="p-3 font-medium text-slate-900">
//                     {row.customerName} <span className="text-xs text-slate-400">({row.saleId})</span>
//                   </td>
//                   <td className="p-3">{row.date}</td>
//                   <td className="p-3">{row.sourceAccount}</td>
//                   <td className="p-3 text-right font-semibold text-slate-800">
//                     PKR {row.amount.toLocaleString()}
//                   </td>
//                 </tr>
//               ))}
//             </tbody>
//           </table>
//         </div>
//       </section>
//     </div>
//   );
  
// }