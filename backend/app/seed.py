"""Seeds the database with the 13 known plants, a few sample parties/rates,
and a handful of real customers — run once after the tables exist:

    python -m app.seed
"""
from datetime import datetime, timedelta

from app.database import SessionLocal, Base, engine
from app import models

COMPANIES = [
    "PSO", "Bouch Plant Pvt Ltd", "Bouch Power Pvt Ltd", "Siddique & Sons", "Yasir Razzaq",
    "Mr. Tufail", "Mr. Hayat Banori", "BSM Pvt Ltd", "Shakir Bilal Colony", "Bouch Wardak",
    "Wali Lal", "H.Gulf", "H.Agah",
]

PARTIES = {
    "PSO": ["Main"],
    "Bouch Plant Pvt Ltd": ["Houch Depot", "Gulf", "Wardak", "Power"],
    "Siddique & Sons": ["Gulf", "Wardak", "Perfect"],
}

SAMPLE_RATES = [
    ("PSO", "Main", 2986, 2, "CEO"),
    ("Bouch Plant Pvt Ltd", "Houch Depot", 3410, 1, "Staff"),
    ("Bouch Plant Pvt Ltd", "Gulf", 3380, 3, "Staff"),
    ("Bouch Plant Pvt Ltd", "Wardak", 3350, 4, "Staff"),
    ("Siddique & Sons", "Gulf", 3400, 1.5, "CEO"),
    ("Siddique & Sons", "Perfect", 3390, 5, "Staff"),
]

CUSTOMERS = [
    ("Fatima Traders", "0300-1234567", "Korangi Industrial Area, Karachi", 1000000, 1200000),
    ("Tahir Shah", "0343-2496052", "Nawe Wasoli Area", 2800000, 3099309),
    ("Mr. Flawar", "0301-9988776", "Site Area, Karachi", 311300, 311300),
    ("Bilal LPG Traders", "0333-4455667", "Landhi, Karachi", 2980000, 2650000),
]


def run():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(models.Company).count() > 0:
            print("Already seeded — skipping. Delete rows manually if you want to reseed.")
            return

        company_map = {}
        for name in COMPANIES:
            c = models.Company(name=name)
            db.add(c)
            db.flush()
            company_map[name] = c

        party_map = {}
        for company_name, party_names in PARTIES.items():
            for pname in party_names:
                p = models.Party(company_id=company_map[company_name].id, name=pname)
                db.add(p)
                db.flush()
                party_map[(company_name, pname)] = p

        for company_name, party_name, rate118, hours_ago, by in SAMPLE_RATES:
            party = party_map[(company_name, party_name)]
            db.add(models.RateEntry(
                company_id=company_map[company_name].id,
                party_id=party.id,
                rate_118=rate118,
                rate_454=round(rate118 * models.RateEntry.RATIO, 2),
                entered_by=by,
                timestamp=datetime.utcnow() - timedelta(hours=hours_ago),
            ))

        month = datetime.utcnow().strftime("%Y-%m")
        for name, mobile, address, opening, current in CUSTOMERS:
            db.add(models.Customer(
                name=name, mobile=mobile, address=address,
                opening_balance=opening, current_balance=current,
                status="active", opening_balance_month=month,
            ))

        db.commit()
        print("Seed complete.")
    finally:
        db.close()


if __name__ == "__main__":
    run()
