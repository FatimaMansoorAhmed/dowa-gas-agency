# sync_db.py
from app.database import SessionLocal
from app import models
from sqlalchemy import func

def fix_balances():
    db = SessionLocal()
    try:
        customers = db.query(models.Customer).all()
        for customer in customers:
            sales_sum = db.query(func.coalesce(func.sum(models.Sale.total_amount), 0)).filter(
                models.Sale.customer_id == customer.id, models.Sale.status == "active"
            ).scalar()

            payments_sum = db.query(func.coalesce(func.sum(models.Payment.amount), 0)).filter(
                models.Payment.customer_id == customer.id, models.Payment.status == "active"
            ).scalar()

            old_bal = customer.current_balance
            new_bal = (customer.opening_balance or 0) + sales_sum - payments_sum
            customer.current_balance = new_bal
            print(f"Customer {customer.name}: Old={old_bal} -> Fixed={new_bal}")

        db.commit()
        print("Done!")
    finally:
        db.close()

if __name__ == "__main__":
    fix_balances()