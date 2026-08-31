"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Send,
  Clock,
  Search,
  X,
  PlusCircle,
  Check,
} from "lucide-react";

import AuthGate from "@/components/AuthGate";
import {
  PageHeader,
  Panel,
  Eyebrow,
  SectionCaption,
  Field,
  Th,
  Td,
  Button,
  inputClass,
} from "@/components/ui";
import { api } from "@/lib/api";
import { fmtTime, isSameKarachiDay } from "@/lib/format";
import { useAuth } from "@/lib/auth";

import type {
  Company,
  Party,
  RateEntry,
} from "@/lib/types";

const RATIO = 45.4 / 11.8;

// ---------------------------------------------------------
// HELPER
// Exact local datetime for <input type="datetime-local" />
// ---------------------------------------------------------
const getLocalDatetimeString = (d = new Date()) => {
  const offset = d.getTimezoneOffset() * 60000;

  return new Date(d.getTime() - offset)
    .toISOString()
    .slice(0, 16);
};

// ---------------------------------------------------------
// WHATSAPP TYPES
// ---------------------------------------------------------
type SellingRate = {
  rate_118: string;
  rate_454: string;
};

function RateDashboardBody() {
  const { user } = useAuth();

  // -------------------------------------------------------
  // DATA
  // -------------------------------------------------------
  const [companies, setCompanies] = useState<Company[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [rates, setRates] = useState<RateEntry[]>([]);

  // -------------------------------------------------------
  // FILTERS
  // -------------------------------------------------------
  const [filterCompany, setFilterCompany] = useState("All");
  const [search, setSearch] = useState("");

  // -------------------------------------------------------
  // WHATSAPP MODAL
  // -------------------------------------------------------
  const [showShareModal, setShowShareModal] = useState(false);

  const [sellingRates, setSellingRates] = useState<
    Record<string, SellingRate>
  >({});

  // -------------------------------------------------------
  // NEW RATE MODAL
  // -------------------------------------------------------
  const [showNewRateModal, setShowNewRateModal] =
    useState(false);

  const [companyId, setCompanyId] = useState("");
  const [partyId, setPartyId] = useState("");

  const [newCompanyName, setNewCompanyName] =
    useState("");

  const [addingCompany, setAddingCompany] =
    useState(false);

  const [newPartyName, setNewPartyName] =
    useState("");

  const [addingParty, setAddingParty] =
    useState(false);

  const [rate118, setRate118] = useState("");

  const [timestamp, setTimestamp] = useState(() =>
    getLocalDatetimeString()
  );

  const [toast, setToast] = useState<string | null>(
    null
  );

  // -------------------------------------------------------
  // LOAD DATA
  // -------------------------------------------------------
  const load = async () => {
    try {
      const [c, p, r] = await Promise.all([
        api.companies.list().catch(() => []),
        api.parties.list().catch(() => []),
        api.rates.list().catch(() => []),
      ]);

      setCompanies(c || []);
      setParties(p || []);
      setRates(r || []);
    } catch (err) {
      console.error(
        "Failed to load rate dashboard data:",
        err
      );
    }
  };

  // -------------------------------------------------------
  // INITIAL LOAD
  // -------------------------------------------------------
  useEffect(() => {
    load();

    const timer = setInterval(() => {
      setTimestamp(getLocalDatetimeString());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  // -------------------------------------------------------
  // LATEST RATE PER PARTY
  // -------------------------------------------------------
  const latestByPartyId = useMemo(() => {
    const m: Record<string, RateEntry> = {};

    rates.forEach((r) => {
      const key = String(r.party_id);

      if (
        !m[key] ||
        new Date(r.timestamp).getTime() >
          new Date(m[key].timestamp).getTime()
      ) {
        m[key] = r;
      }
    });

    return m;
  }, [rates]);

  // -------------------------------------------------------
  // GROUP LATEST RATES BY COMPANY
  // -------------------------------------------------------
  const grouped = useMemo(() => {
    const g: Record<string, RateEntry[]> = {};

    Object.values(latestByPartyId).forEach((r) => {
      const cid = String(r.company_id);

      g[cid] = g[cid] || [];
      g[cid].push(r);
    });

    Object.values(g).forEach((arr) =>
      arr.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() -
          new Date(a.timestamp).getTime()
      )
    );

    return g;
  }, [latestByPartyId]);

  // -------------------------------------------------------
  // COMPANY ORDER
  // -------------------------------------------------------
  const companyOrder = useMemo(() => {
    return Object.keys(grouped).sort((a, b) => {
      const la = Math.max(
        ...grouped[a].map((r) =>
          new Date(r.timestamp).getTime()
        )
      );

      const lb = Math.max(
        ...grouped[b].map((r) =>
          new Date(r.timestamp).getTime()
        )
      );

      return lb - la;
    });
  }, [grouped]);

  // -------------------------------------------------------
  // HISTORY
  // -------------------------------------------------------
  const history = useMemo(() => {
    return rates
      .filter(
        (r) =>
          filterCompany === "All" ||
          String(r.company_id) ===
            String(filterCompany)
      )
      .filter((r) => {
        if (!search.trim()) return true;

        const company =
          companies.find(
            (c) =>
              String(c.id) === String(r.company_id)
          )?.name || "";

        const party =
          parties.find(
            (p) =>
              String(p.id) === String(r.party_id)
          )?.name || "";

        return (
          company +
          " " +
          party
        )
          .toLowerCase()
          .includes(search.toLowerCase());
      })
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() -
          new Date(a.timestamp).getTime()
      );
  }, [
    rates,
    filterCompany,
    search,
    companies,
    parties,
  ]);

  // -------------------------------------------------------
  // TODAY'S ENTRIES
  // -------------------------------------------------------
  const todayEntries = useMemo(
    () =>
      rates
        .filter((r) =>
          isSameKarachiDay(r.timestamp)
        )
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() -
            new Date(a.timestamp).getTime()
        ),
    [rates]
  );

  // -------------------------------------------------------
  // COMPANY -> PARTIES
  // -------------------------------------------------------
  const companyParties = parties.filter(
    (p) => p.company_id === companyId
  );

  // -------------------------------------------------------
  // RATE 45.4 PREVIEW
  // -------------------------------------------------------
  const rate454Preview = rate118
    ? Math.round(
        parseFloat(rate118) * RATIO * 100
      ) / 100
    : null;

  // =======================================================
  // WHATSAPP FUNCTIONS
  // =======================================================

  // -------------------------------------------------------
  // OPEN WHATSAPP MODAL
  // -------------------------------------------------------
  const handleOpenShareModal = () => {
    const initialRates: Record<
      string,
      SellingRate
    > = {};

    // Party-wise entries
    Object.values(latestByPartyId).forEach((r) => {
      initialRates[String(r.id)] = {
        rate_118: "",
        rate_454: "",
      };
    });

    setSellingRates(initialRates);
    setShowShareModal(true);
  };

  // -------------------------------------------------------
  // CHANGE SELLING RATE
  // -------------------------------------------------------
  const handleRateChange = (
    key: string,
    field: "rate_118" | "rate_454",
    value: string
  ) => {
    setSellingRates((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value,
      },
    }));
  };

  // -------------------------------------------------------
  // SEND WHATSAPP (PARTY WISE ONLY)
  // -------------------------------------------------------
  const sendWhatsAppSellingRates = () => {
    let text =
      `*DOWA GAS AGENCY — Today's Selling Rates*\n` +
      `Date: ${new Date().toLocaleDateString(
        "en-GB",
        {
          timeZone: "Asia/Karachi",
        }
      )}\n\n`;

    let hasEntries = false;

    const partyEntries =
      Object.values(latestByPartyId);

    partyEntries
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() -
          new Date(a.timestamp).getTime()
      )
      .forEach((r) => {
        const company =
          companies.find(
            (c) =>
              String(c.id) ===
              String(r.company_id)
          );

        const party =
          parties.find(
            (p) =>
              String(p.id) ===
              String(r.party_id)
          );

        const key = String(r.id);

        const sRate = sellingRates[key];

        if (
          sRate &&
          (
            sRate.rate_118.trim() ||
            sRate.rate_454.trim()
          )
        ) {
          hasEntries = true;

          text +=
            `*${company?.name || "Company"}*\n`;

          text +=
            `Party: ${
              party?.name || "Party"
            }\n`;

          text +=
            `Selling Rate: ` +
            `${sRate.rate_118 || "—"} / ` +
            `${sRate.rate_454 || "—"} ` +
            `(11.8kg / 45.4kg)\n\n`;
        }
      });

    // -----------------------------------------------------
    // VALIDATION
    // -----------------------------------------------------
    if (!hasEntries) {
      alert(
        "Please enter at least one selling rate before sharing."
      );
      return;
    }

    // -----------------------------------------------------
    // OPEN WHATSAPP
    // -----------------------------------------------------
    window.open(
      `https://wa.me/?text=${encodeURIComponent(
        text
      )}`,
      "_blank"
    );

    setShowShareModal(false);
  };

  // =======================================================
  // NEW RATE FUNCTIONS
  // =======================================================

  // -------------------------------------------------------
  // RESET NEW RATE FORM
  // -------------------------------------------------------
  const resetNewRateForm = () => {
    setCompanyId("");
    setPartyId("");
    setRate118("");
    setNewCompanyName("");
    setAddingCompany(false);
    setNewPartyName("");
    setAddingParty(false);
    setTimestamp(
      getLocalDatetimeString()
    );
  };

  // -------------------------------------------------------
  // ADD COMPANY
  // -------------------------------------------------------
  const handleAddCompany = async () => {
    if (!newCompanyName.trim()) return;

    const c = await api.companies.create({
      name: newCompanyName.trim(),
    });

    setCompanies((prev) => [
      ...prev,
      c,
    ]);

    setCompanyId(c.id);
    setPartyId("");

    setNewCompanyName("");
    setAddingCompany(false);
  };

  // -------------------------------------------------------
  // ADD PARTY
  // -------------------------------------------------------
  const handleAddParty = async () => {
    if (
      !newPartyName.trim() ||
      !companyId
    ) {
      return;
    }

    const p = await api.parties.create(
      companyId,
      newPartyName.trim()
    );

    setParties((prev) => [
      ...prev,
      p,
    ]);

    setPartyId(p.id);

    setNewPartyName("");
    setAddingParty(false);
  };

  // -------------------------------------------------------
  // SAVE RATE
  // -------------------------------------------------------
  const handleSaveRate = async () => {
    if (
      !companyId ||
      !partyId ||
      !rate118 ||
      !user
    ) {
      return;
    }

    await api.rates.create({
      company_id: companyId,
      party_id: partyId,
      rate_118: parseFloat(rate118),
      entered_by: user.name,
      timestamp:
        new Date(timestamp).toISOString(),
    });

    setToast("Rate saved.");

    setRate118("");

    setTimestamp(
      getLocalDatetimeString()
    );

    await load();

    setTimeout(
      () => setToast(null),
      2200
    );
  };

  // =======================================================
  // UI
  // =======================================================

  return (
    <div>
      {/* ===================================================
          PAGE HEADER
      =================================================== */}
      <PageHeader
        eyebrow="Rate Dashboard"
        title="What's the rate right now"
        caption="Latest applied rate per Company · Party, plus the full timestamped history underneath."
        action={
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={() => {
                resetNewRateForm();
                setShowNewRateModal(true);
              }}
            >
              <PlusCircle size={14} />
              Add New Rate
            </Button>

            <Button
              variant="teal"
              onClick={handleOpenShareModal}
            >
              <Send size={14} />
              Share Selling Rates on WhatsApp
            </Button>
          </div>
        }
      />

      {/* ===================================================
          LATEST RATES
      =================================================== */}
      <Panel className="mb-4">
        <Eyebrow>
          Latest Rates
        </Eyebrow>

        <SectionCaption>
          Grouped by company, most recently updated first.
        </SectionCaption>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {companyOrder.map((cid) => {
            const company =
              companies.find(
                (c) =>
                  String(c.id) ===
                  String(cid)
              );

            return (
              <div
                key={cid}
                className="border border-hairline rounded-lg px-3.5 py-3"
              >
                <div className="font-body font-semibold text-[13.5px] text-ink mb-2">
                  {company?.name ||
                    "Unknown Company"}
                </div>

                <div className="flex flex-col gap-1.5">
                  {grouped[cid].map((r) => {
                    const party =
                      parties.find(
                        (p) =>
                          String(p.id) ===
                          String(r.party_id)
                      );

                    return (
                      <div
                        key={r.id}
                        className="flex justify-between items-baseline"
                      >
                        <span className="font-body text-xs text-steel">
                          {party?.name ||
                            "Party"}
                        </span>

                        <span className="text-right">
                          <span className="font-mono text-[13px] font-semibold text-ink">
                            {r.rate_118}
                          </span>

                          <span className="font-mono text-[10.5px] text-steel">
                            {" "}
                            / {r.rate_454}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="font-mono text-[9.5px] text-steel mt-2 flex items-center gap-1">
                  <Clock size={10} />
                  updated{" "}
                  {fmtTime(
                    grouped[cid][0]
                      .timestamp
                  )}
                </div>
              </div>
            );
          })}

          {!companyOrder.length && (
            <div className="font-body text-steel text-[13px] col-span-3">
              No rates entered yet.
            </div>
          )}
        </div>
      </Panel>

      {/* ===================================================
          RATE HISTORY
      =================================================== */}
      <Panel>
        <div className="flex justify-between items-center mb-1 flex-wrap gap-2.5">
          <Eyebrow>
            Rate History Log
          </Eyebrow>

          <div className="flex gap-2">
            <select
              value={filterCompany}
              onChange={(e) =>
                setFilterCompany(
                  e.target.value
                )
              }
              className={`${inputClass} w-[180px] py-1.5 text-xs`}
            >
              <option value="All">
                All companies
              </option>

              {companies.map((c) => (
                <option
                  key={c.id}
                  value={c.id}
                >
                  {c.name}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1.5 border border-hairline rounded-md px-2.5">
              <Search
                size={13}
                className="text-steel"
              />

              <input
                value={search}
                onChange={(e) =>
                  setSearch(
                    e.target.value
                  )
                }
                placeholder="Search company or party"
                className="border-none outline-none font-body text-xs py-1.5 w-[180px]"
              />
            </div>
          </div>
        </div>

        <div className="max-h-[360px] overflow-y-auto mt-2.5">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Company</Th>
                <Th>Party</Th>
                <Th right>
                  11.8kg
                </Th>
                <Th right>
                  45.4kg
                </Th>
                <Th right>
                  Timestamp
                </Th>
                <Th>
                  Entered By
                </Th>
              </tr>
            </thead>

            <tbody>
              {history.map((r) => {
                const company =
                  companies.find(
                    (c) =>
                      String(c.id) ===
                      String(r.company_id)
                  );

                const party =
                  parties.find(
                    (p) =>
                      String(p.id) ===
                      String(r.party_id)
                  );

                return (
                  <tr key={r.id}>
                    <Td bold>
                      {company?.name ||
                        "—"}
                    </Td>

                    <Td>
                      {party?.name ||
                        "—"}
                    </Td>

                    <Td
                      right
                      mono
                    >
                      {r.rate_118}
                    </Td>

                    <Td
                      right
                      mono
                      color="#0F8B8D"
                    >
                      {r.rate_454}
                    </Td>

                    <Td
                      right
                      mono
                    >
                      {fmtTime(
                        r.timestamp
                      )}
                    </Td>

                    <Td>
                      {r.entered_by}
                    </Td>
                  </tr>
                );
              })}

              {!history.length && (
                <tr>
                  <td
                    colSpan={6}
                    className="text-steel text-[13px] py-3 text-center"
                  >
                    No rate entries
                    found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ===================================================
          NEW RATE ENTRY MODAL
      =================================================== */}
      {showNewRateModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 p-3 sm:p-5 flex items-center justify-center"
          onMouseDown={(e) => {
            if (
              e.target ===
              e.currentTarget
            ) {
              setShowNewRateModal(
                false
              );
            }
          }}
        >
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-2xl">

            {/* HEADER */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
              <div>
                <Eyebrow>
                  New Rate Entry
                </Eyebrow>

                <div className="font-body text-xs text-steel mt-1">
                  One entry per change —
                  nothing gets overwritten,
                  even multiple times a day.
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowNewRateModal(
                    false
                  )
                }
                className="p-2 rounded-md hover:bg-paper text-steel hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>

            {/* BODY */}
            <div className="p-5 flex flex-col gap-3.5">

              {/* COMPANY */}
              <Field label="Company">
                {!addingCompany ? (
                  <div className="flex gap-1.5">
                    <select
                      value={companyId}
                      onChange={(e) => {
                        setCompanyId(
                          e.target.value
                        );
                        setPartyId("");
                      }}
                      className={`${inputClass} flex-1`}
                    >
                      <option value="">
                        Select company
                      </option>

                      {companies.map(
                        (c) => (
                          <option
                            key={c.id}
                            value={c.id}
                          >
                            {c.name}
                          </option>
                        )
                      )}
                    </select>

                    <Button
                      variant="outline"
                      onClick={() =>
                        setAddingCompany(
                          true
                        )
                      }
                    >
                      <PlusCircle
                        size={14}
                      />
                      Add
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <input
                      autoFocus
                      value={
                        newCompanyName
                      }
                      onChange={(e) =>
                        setNewCompanyName(
                          e.target.value
                        )
                      }
                      placeholder="New company name"
                      className={`${inputClass} flex-1`}
                    />

                    <Button
                      variant="teal"
                      onClick={
                        handleAddCompany
                      }
                    >
                      <Check
                        size={14}
                      />
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() => {
                        setAddingCompany(
                          false
                        );
                        setNewCompanyName(
                          ""
                        );
                      }}
                    >
                      <X
                        size={14}
                      />
                    </Button>
                  </div>
                )}
              </Field>

              {/* PARTY */}
              <Field label="Party">
                {!addingParty ? (
                  <div className="flex gap-1.5">
                    <select
                      value={partyId}
                      onChange={(e) =>
                        setPartyId(
                          e.target.value
                        )
                      }
                      disabled={
                        !companyId
                      }
                      className={`${inputClass} flex-1`}
                    >
                      <option value="">
                        {companyId
                          ? "Select party"
                          : "Select company first"}
                      </option>

                      {companyParties.map(
                        (p) => (
                          <option
                            key={p.id}
                            value={p.id}
                          >
                            {p.name}
                          </option>
                        )
                      )}
                    </select>

                    <Button
                      variant="outline"
                      onClick={() =>
                        setAddingParty(
                          true
                        )
                      }
                      disabled={
                        !companyId
                      }
                    >
                      <PlusCircle
                        size={14}
                      />
                      Add
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <input
                      autoFocus
                      value={
                        newPartyName
                      }
                      onChange={(e) =>
                        setNewPartyName(
                          e.target.value
                        )
                      }
                      placeholder="New party name"
                      className={`${inputClass} flex-1`}
                    />

                    <Button
                      variant="teal"
                      onClick={
                        handleAddParty
                      }
                    >
                      <Check
                        size={14}
                      />
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() => {
                        setAddingParty(
                          false
                        );
                        setNewPartyName(
                          ""
                        );
                      }}
                    >
                      <X
                        size={14}
                      />
                    </Button>
                  </div>
                )}
              </Field>

              {/* RATE */}
              <Field label="Rate — 11.8kg (domestic)">
                <input
                  type="number"
                  value={rate118}
                  onChange={(e) =>
                    setRate118(
                      e.target.value
                    )
                  }
                  placeholder="e.g. 3410"
                  className={inputClass}
                />
              </Field>

              {/* 45.4 PREVIEW */}
              <div className="flex justify-between items-center px-3 py-2.5 bg-paper rounded-lg border border-hairline">
                <span className="font-mono text-[11px] text-steel">
                  Auto-calculated · 45.4kg
                  (commercial)
                </span>

                <span className="font-display font-bold text-base text-teal">
                  {rate454Preview ??
                    "—"}
                </span>
              </div>

              {/* TIMESTAMP */}
              <Field label="Timestamp">
                <input
                  type="datetime-local"
                  value={timestamp}
                  onChange={(e) =>
                    setTimestamp(
                      e.target.value
                    )
                  }
                  className={inputClass}
                />
              </Field>

              {/* ENTERED BY */}
              <Field label="Entered by">
                <input
                  value={
                    user?.name || ""
                  }
                  disabled
                  className={`${inputClass} bg-paper text-steel`}
                />
              </Field>

              {/* SAVE */}
              <Button
                variant="primary"
                onClick={async () => {
                  await handleSaveRate();

                  setShowNewRateModal(
                    false
                  );
                }}
                disabled={
                  !companyId ||
                  !partyId ||
                  !rate118
                }
              >
                Save Rate Entry
              </Button>

              {/* TOAST */}
              {toast && (
                <div className="font-body text-[12.5px] text-brand-green flex items-center gap-1.5">
                  <Check
                    size={13}
                  />
                  {toast}
                </div>
              )}

              {/* TODAY */}
              {todayEntries.length >
                0 && (
                <div className="border-t border-hairline pt-3 mt-1">

                  <div className="font-mono text-[10px] uppercase text-steel mb-1.5">
                    Today's Entries
                  </div>

                  <div className="max-h-[140px] overflow-y-auto flex flex-col gap-1">
                    {todayEntries.map(
                      (r) => {
                        const company =
                          companies.find(
                            (c) =>
                              String(
                                c.id
                              ) ===
                              String(
                                r.company_id
                              )
                          );

                        const party =
                          parties.find(
                            (p) =>
                              String(
                                p.id
                              ) ===
                              String(
                                r.party_id
                              )
                          );

                        return (
                          <div
                            key={r.id}
                            className="flex justify-between text-xs font-body"
                          >
                            <span>
                              {
                                company?.name
                              }{" "}
                              ·{" "}
                              {
                                party?.name
                              }
                            </span>

                            <span className="font-mono text-steel">
                              {
                                r.rate_118
                              }{" "}
                              /{" "}
                              {
                                r.rate_454
                              }
                            </span>
                          </div>
                        );
                      }
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================
          WHATSAPP SELLING RATES MODAL (PARTY-WISE ONLY)
      =================================================== */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">

          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden relative border border-hairline">

            {/* HEADER */}
            <div className="px-5 py-4 border-b border-hairline flex items-start justify-between">
              <div>
                <Eyebrow>
                  WhatsApp Selling Rates
                </Eyebrow>

                <h3 className="font-display font-bold text-lg text-ink mb-1">
                  Enter Selling Rates to Send
                </h3>

                <p className="text-xs text-steel">
                  Enter party selling rates below. Blank entries won't be sent.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowShareModal(
                    false
                  )
                }
                className="text-steel hover:text-ink p-1"
              >
                <X size={18} />
              </button>
            </div>

            {/* BODY */}
            <div className="p-5 overflow-y-auto max-h-[calc(90vh-150px)]">
              <div className="flex flex-col gap-3 mb-2">
                <div className="font-mono text-[10px] uppercase text-steel">
                  Party Selling Rates
                </div>

                {Object.values(
                  latestByPartyId
                ).map((r) => {
                  const company =
                    companies.find(
                      (c) =>
                        String(c.id) ===
                        String(r.company_id)
                    );

                  const party =
                    parties.find(
                      (p) =>
                        String(p.id) ===
                        String(r.party_id)
                    );

                  const key = String(r.id);

                  return (
                    <div
                      key={key}
                      className="p-3 border border-hairline rounded-lg bg-gray-50"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <div className="font-body text-xs font-semibold text-ink">
                            {party?.name || "Party"}
                          </div>

                          <div className="font-body text-[10px] text-steel">
                            {company?.name || "Company"}
                          </div>
                        </div>

                        <div className="font-mono text-[9px] text-steel">
                          Current: {r.rate_118} / {r.rate_454}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-steel block mb-0.5">
                            Selling Rate (11.8kg)
                          </label>

                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="e.g. 2800"
                            value={
                              sellingRates[key]?.rate_118 || ""
                            }
                            onChange={(e) =>
                              handleRateChange(
                                key,
                                "rate_118",
                                e.target.value
                              )
                            }
                            className={`${inputClass} text-xs py-1`}
                          />
                        </div>

                        <div>
                          <label className="text-[10px] text-steel block mb-0.5">
                            Selling Rate (45.4kg)
                          </label>

                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="e.g. 10500"
                            value={
                              sellingRates[key]?.rate_454 || ""
                            }
                            onChange={(e) =>
                              handleRateChange(
                                key,
                                "rate_454",
                                e.target.value
                              )
                            }
                            className={`${inputClass} text-xs py-1`}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}

                {!Object.keys(latestByPartyId).length && (
                  <div className="text-xs text-steel py-3 text-center">
                    No party rates found.
                  </div>
                )}
              </div>
            </div>

            {/* FOOTER */}
            <div className="px-5 py-3 border-t border-hairline flex justify-end gap-2 bg-white">
              <Button
                variant="outline"
                onClick={() =>
                  setShowShareModal(
                    false
                  )
                }
              >
                Cancel
              </Button>

              <Button
                variant="teal"
                onClick={sendWhatsAppSellingRates}
              >
                <Send size={14} />
                Send via WhatsApp
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================================
// PAGE
// =========================================================
export default function RateDashboardPage() {
  return (
    <AuthGate>
      <RateDashboardBody />
    </AuthGate>
  );
}