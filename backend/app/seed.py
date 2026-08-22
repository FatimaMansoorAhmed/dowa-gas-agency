"""Seeds the database with the 13 known plants, a few sample parties/rates,
a handful of real customers, and — for Mukarram specifically — a real
August ledger (sales + payments) so the Customer Ledger page has something
to show that mirrors the source Excel. Run once after the tables exist:

    python -m app.seed
"""
from datetime import datetime, timedelta

from app.database import SessionLocal
from app import models
from app.utils import next_display_id

COMPANIES = [
    # (name, mobile, current payable — matches the real Excel plant payables sheet)
    ("PSO", "0305-2512117", 2971042),
    ("Bouch Plant Pvt Ltd", "0332-2150249", 8326588),
    ("Bouch Power Pvt Ltd", "0332-2150250", -1),
    ("Siddique & Sons", "0312-2884122", 1924679),
    ("Yasir Razzaq", "0321-9293218", 1996061),
    ("Mr. Tufail", "0321-2213155", 2045047),
    ("Mr. Hayat Banori", "0344-1246010", 7144574),
    ("BSM Pvt Ltd", None, 612368),
    ("Shakir Bilal Colony", None, 0),
    ("Bouch Wardak", None, -6772),
    ("Wali Lal", "0304-2157138", 0),
    ("H.Gulf", None, 504594),
    ("H.Agah", None, -10231),
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

PRODUCTS = [("11.8 KG Cylinder", 11.8), ("45.4 KG Cylinder", 45.4)]

PAYMENT_ACCOUNTS = [
    ("Main Cash", "cash", 0),
    ("Meezan Bank", "bank", 0),
    ("HBL", "bank", 0),
    ("UBL", "bank", 0),
    
]

EXPENSE_CATEGORIES = [
    "Home Expense", "Office Expense", "Shop Expense", "Electricity", "Fuel",
    "Vehicle Maintenance", "Salary", "Rent", "Loading/Unloading",
    "Transportation", "Repairs", "Bank Charges", "Miscellaneous",
]

# Mukarram's August 2026 ledger — reproduces the worked example from the
# source Excel (§40 in the spec). Rate is the domestic 11.8kg rate exactly
# as tracked in the Rate module; the actual 45.4kg cylinder price is
# derived the same way rate_454 always is (rate_118 * 45.4/11.8).
RATIO = 45.4 / 11.8
MUKARRAM_ROWS = [
    # (day, domestic_rate, qty_45.4, payment_amount)
    (1, 3800, 16, 234000),
    (3, 3720, 16, 218400),
    (4, 3660, 16, 215310),
    (5, 3560, 16, 219150),
    (6, 3490, 16, 214800),
    (8, 3830, 16, 235770),
    (10, 3830, 16, 235800),
    (11, 3780, 16, 232700),
]


def run():
    # Schema is owned by Alembic now — run `alembic upgrade head` first.
    # If that hasn't been done, this fails with a clear "no such table"
    # instead of silently creating a schema that may not match the last
    # migration, which is exactly the drift Alembic is here to prevent.
    db = SessionLocal()
    try:
        if db.query(models.Company).count() > 0:
            print("Already seeded — skipping. Delete rows manually if you want to reseed.")
            return

        company_map = {}
        for name, mobile, payable in COMPANIES:
            c = models.Company(
                name=name, mobile=mobile,
                opening_balance=payable, opening_balance_date=datetime(2026, 8, 1),
                current_balance=payable, opening_balance_month="2026-08",
            )
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
        customer_map = {}
        for name, mobile, address, opening, current in CUSTOMERS:
            cust = models.Customer(
                display_id=next_display_id(db, models.Customer, "CUST"),
                name=name, mobile=mobile, address=address,
                opening_balance=opening, opening_balance_date=datetime(2026, 1, 1),
                current_balance=current,
                status="active", opening_balance_month=month,
            )
            db.add(cust)
            db.flush()
            customer_map[name] = cust

        product_map = {}
        for name, weight in PRODUCTS:
            p = models.Product(name=name, weight_kg=weight, active="active")
            db.add(p)
            db.flush()
            product_map[weight] = p

        account_map = {}
        for name, kind, opening in PAYMENT_ACCOUNTS:
            a = models.PaymentAccount(name=name, kind=kind, opening_balance=opening, current_balance=opening, active="active")
            db.add(a)
            db.flush()
            account_map[name] = a

        for name in EXPENSE_CATEGORIES:
            db.add(models.ExpenseCategory(name=name, active="active"))

        # Mukarram — full August ledger, added on top of the four generic
        # sample customers above so the Customer Ledger page has real data.
        mukarram = models.Customer(
            display_id=next_display_id(db, models.Customer, "CUST"),
            name="Mukarram", mobile="0341-2373387", shop_name=None,
            opening_balance=805206, opening_balance_date=datetime(2026, 8, 1),
            current_balance=805206, status="active", opening_balance_month="2026-08",
        )
        db.add(mukarram)
        db.flush()
        customer_map["Mukarram"] = mukarram

        bouch = company_map["Bouch Plant Pvt Ltd"]
        product_454 = product_map[45.4]
        main_cash = account_map["Main Cash"]
        running = float(mukarram.current_balance)

        for day, domestic_rate, qty, payment_amount in MUKARRAM_ROWS:
            rate_per_cyl = round(domestic_rate * RATIO, 2)
            total_amount = round(qty * rate_per_cyl, 2)
            sale_date = datetime(2026, 8, day, 10, 0)

            sale = models.Sale(
                display_id=next_display_id(db, models.Sale, "SALE", width=6),
                date=sale_date, customer_id=mukarram.id, product_id=product_454.id,
                company_id=bouch.id, quantity=qty, weight_per_cylinder=45.4,
                total_kg=qty * 45.4, rate_per_kg=round(rate_per_cyl / 45.4, 2),
                rate_per_cylinder=rate_per_cyl, total_amount=total_amount,
                vehicle_no="KW-4729", status="active", entered_by="Staff",
            )
            db.add(sale)
            db.flush()
            running += total_amount

            payment = models.Payment(
                display_id=next_display_id(db, models.Payment, "PAY", width=6),
                date=sale_date, customer_id=mukarram.id, sale_id=sale.id,
                amount=payment_amount, method="cash", account_id=main_cash.id,
                status="active", entered_by="Staff",
            )
            db.add(payment)
            running -= payment_amount
            main_cash.current_balance = main_cash.current_balance + payment_amount

        mukarram.current_balance = running
        mukarram.last_transaction_at = datetime(2026, 8, 11, 10, 0)
        db.add(mukarram)
        db.add(main_cash)

        # A couple of sample Purchase + CompanyPayment rows so the Plant
        # Ledger drill-down isn't empty on first load — layered on top of
        # each company's anchored August-1 payable set above.
        pso = company_map["PSO"]
        product_454 = product_map[45.4]
        sample_purchases = [
            (pso, 5, 2986, 30, 5000, 300000),
            (bouch, 10, 3410, 20, 3000, 200000),
        ]
        for company, day, domestic_rate, qty, transport, payment_amount in sample_purchases:
            rate_per_cyl = round(domestic_rate * RATIO, 2)
            cylinder_amount = round(qty * rate_per_cyl, 2)
            total_amount = cylinder_amount + transport
            pdate = datetime(2026, 8, day, 11, 0)

            purchase = models.Purchase(
                display_id=next_display_id(db, models.Purchase, "PUR", width=6),
                date=pdate, company_id=company.id, product_id=product_454.id,
                quantity=qty, weight_per_cylinder=45.4, total_kg=qty * 45.4,
                rate_per_kg=round(rate_per_cyl / 45.4, 2), rate_per_cylinder=rate_per_cyl,
                transport_charges=transport, total_amount=total_amount,
                vehicle_no="KP-7517", status="active", entered_by="Staff",
            )
            db.add(purchase)
            db.flush()
            company.current_balance = company.current_balance + total_amount

            cpayment = models.CompanyPayment(
                display_id=next_display_id(db, models.CompanyPayment, "CPAY", width=6),
                date=pdate, company_id=company.id, purchase_id=purchase.id,
                amount=payment_amount, method="cash", account_id=main_cash.id,
                status="active", entered_by="Staff",
            )
            db.add(cpayment)
            company.current_balance = company.current_balance - payment_amount
            main_cash.current_balance = main_cash.current_balance - payment_amount
            db.add(company)
            db.add(main_cash)

        db.commit()
        print("Seed complete.")
    finally:
        db.close()


if __name__ == "__main__":
    run()