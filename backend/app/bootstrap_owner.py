"""Creates the very first Owner account — the only way an Owner is ever
created outside the normal approve-as-owner flow (routers/users.py's
approve_user with role="owner"). Not a public route; run once, manually:

    python -m app.bootstrap_owner

Reads BOOTSTRAP_OWNER_NAME / BOOTSTRAP_OWNER_EMAIL / BOOTSTRAP_OWNER_PASSWORD
from the environment (.env). Refuses to run — no-ops with a clear message —
the moment ANY Owner already exists, so this can never be re-run to create a
second unauthorized Owner (every Owner after the first comes only from an
existing, authenticated Owner approving a registrant into the Owner role).
"""
import os
import sys

from argon2 import PasswordHasher
from dotenv import load_dotenv

from app.database import Base, engine, SessionLocal
from app import models

load_dotenv()


def run():
    name = os.getenv("BOOTSTRAP_OWNER_NAME")
    email = os.getenv("BOOTSTRAP_OWNER_EMAIL")
    password = os.getenv("BOOTSTRAP_OWNER_PASSWORD")

    if not (name and email and password):
        print("BOOTSTRAP_OWNER_NAME, BOOTSTRAP_OWNER_EMAIL and BOOTSTRAP_OWNER_PASSWORD must all be set (in .env) to bootstrap the first Owner.")
        sys.exit(1)
    if len(password) < 8:
        print("BOOTSTRAP_OWNER_PASSWORD must be at least 8 characters.")
        sys.exit(1)

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        existing_owner = db.query(models.User).filter(models.User.role == "owner").first()
        if existing_owner:
            print(f"An Owner account already exists ({existing_owner.email}) — refusing to bootstrap a second one. "
                  f"Use an existing Owner's account to approve a new registrant into the Owner role instead.")
            return

        email_norm = email.strip().lower()
        if db.query(models.User).filter(models.User.email == email_norm).first():
            print(f"A user with email {email_norm} already exists — refusing to overwrite it. Choose a different BOOTSTRAP_OWNER_EMAIL.")
            sys.exit(1)

        hasher = PasswordHasher()
        user = models.User(
            name=name.strip(),
            email=email_norm,
            password_hash=hasher.hash(password),
            role="owner",
            status="active",
            email_verified=False,
        )
        db.add(user)
        db.flush()
        db.add(models.UserAccessAudit(user_id=user.id, action="approve", performed_by=None, reason="bootstrap"))
        db.commit()
        print(f"Owner account created: {email_norm}")
    finally:
        db.close()


if __name__ == "__main__":
    run()
