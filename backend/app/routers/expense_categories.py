from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_active_user, require_csrf

router = APIRouter(prefix="/expense-categories", tags=["expense-categories"], dependencies=[Depends(require_active_user), Depends(require_csrf)])


@router.get("", response_model=list[schemas.ExpenseCategoryOut])
def list_categories(db: Session = Depends(get_db)):
    return db.query(models.ExpenseCategory).order_by(models.ExpenseCategory.name).all()


@router.post("", response_model=schemas.ExpenseCategoryOut, status_code=201)
def create_category(payload: schemas.ExpenseCategoryCreate, db: Session = Depends(get_db)):
    existing = db.query(models.ExpenseCategory).filter(models.ExpenseCategory.name == payload.name).first()
    if existing:
        return existing  # idempotent — same behavior as party add
    category = models.ExpenseCategory(name=payload.name, description=payload.description, active="active")
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.patch("/{category_id}/deactivate", response_model=schemas.ExpenseCategoryOut)
def deactivate_category(category_id: UUID, db: Session = Depends(get_db)):
    """Deactivate, never delete — historical expenses must keep their category (§42)."""
    category = db.query(models.ExpenseCategory).get(category_id)
    if not category:
        raise HTTPException(404, "Category not found")
    # System-provided category (§ Employee Salary Tracking) — the app
    # itself depends on "Salary" existing and staying active (the Employee
    # picker's required-category check keys off it by name), so unlike
    # every user-created category this one can never be deactivated. Same
    # "no removal path at all" outcome Product already has, just enforced
    # here since ExpenseCategory (unlike Product) has a real deactivate
    # endpoint to guard.
    if category.is_system:
        raise HTTPException(400, "This is a system-provided category and cannot be deactivated")
    category.active = "inactive"
    db.add(category)
    db.commit()
    db.refresh(category)
    return category