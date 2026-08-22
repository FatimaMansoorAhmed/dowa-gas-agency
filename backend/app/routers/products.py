from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas

router = APIRouter(prefix="/products", tags=["products"])


@router.get("", response_model=list[schemas.ProductOut])
def list_products(db: Session = Depends(get_db)):
    return db.query(models.Product).order_by(models.Product.weight_kg).all()


@router.post("", response_model=schemas.ProductOut, status_code=201)
def create_product(payload: schemas.ProductCreate, db: Session = Depends(get_db)):
    existing = db.query(models.Product).filter(models.Product.name == payload.name).first()
    if existing:
        raise HTTPException(400, "Product already exists")
    product = models.Product(
        name=payload.name, 
        weight_kg=payload.weight_kg, 
        status=getattr(payload, 'status', 'active')
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.post("/get-or-create", response_model=schemas.ProductOut)
def get_or_create_product(weight_kg: float, db: Session = Depends(get_db)):
    # Weight ke hisab se product search karein
    product = db.query(models.Product).filter(models.Product.weight_kg == weight_kg).first()
    
    if not product:
        name = f"{weight_kg} KG Cylinder"
        product = models.Product(name=name, weight_kg=weight_kg, status="active")
        db.add(product)
        db.commit()
        db.refresh(product)
        
    return product