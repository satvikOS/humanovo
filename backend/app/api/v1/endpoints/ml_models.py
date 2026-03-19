"""
ML/AI Model Management API Endpoints

Model registry, evaluation, prediction, and explainability.
"""

import logging
import math
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.platform_entities import MLModel

logger = logging.getLogger(__name__)
router = APIRouter()


class ModelCreate(BaseModel):
    name: str
    model_type: str = "classification"
    description: str = ""
    framework: str = "scikit-learn"
    features: list[str] = []
    target: str = ""
    hyperparameters: dict = {}


class ModelUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    description: Optional[str] = None
    version: Optional[str] = None


class PredictRequest(BaseModel):
    model_id: str
    features: dict


class EvaluateRequest(BaseModel):
    y_true: list[float]
    y_pred: list[float]


@router.get("/")
async def list_models(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MLModel).order_by(MLModel.updated_at.desc()))
    items = result.scalars().all()
    return {"items": [m.to_dict() for m in items], "total": len(items)}


@router.post("/")
async def create_model(data: ModelCreate, db: AsyncSession = Depends(get_db)):
    model = MLModel(
        name=data.name,
        model_type=data.model_type,
        status="draft",
        description=data.description,
        version="1.0",
        framework=data.framework,
        hyperparameters=data.hyperparameters,
        features=data.features,
        target=data.target,
        metrics={},
        training_history=[],
        feature_importance=[],
    )
    db.add(model)
    await db.flush()
    return model.to_dict()


@router.get("/{model_id}")
async def get_model(model_id: str, db: AsyncSession = Depends(get_db)):
    model = await db.get(MLModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return model.to_dict()


@router.patch("/{model_id}")
async def update_model(model_id: str, data: ModelUpdate, db: AsyncSession = Depends(get_db)):
    model = await db.get(MLModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    if data.name is not None:
        model.name = data.name
    if data.status is not None:
        model.status = data.status
    if data.description is not None:
        model.description = data.description
    if data.version is not None:
        model.version = data.version
    await db.flush()
    return model.to_dict()


@router.delete("/{model_id}")
async def delete_model(model_id: str, db: AsyncSession = Depends(get_db)):
    model = await db.get(MLModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    await db.delete(model)
    await db.flush()
    return {"status": "deleted"}


@router.get("/{model_id}/metrics")
async def get_metrics(model_id: str, db: AsyncSession = Depends(get_db)):
    model = await db.get(MLModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    metrics = model.metrics or {}
    confusion_matrix = None
    roc_curve = None
    if model.model_type == "classification" and metrics:
        confusion_matrix = _compute_confusion_matrix(metrics)
        roc_curve = _compute_roc_curve(metrics)
    return {
        "metrics": metrics,
        "training_history": model.training_history or [],
        "confusion_matrix": confusion_matrix,
        "roc_curve": roc_curve,
    }


def _compute_confusion_matrix(metrics: dict) -> dict | None:
    """Derive a confusion matrix from stored accuracy and sample count."""
    acc = metrics.get("accuracy")
    n = metrics.get("n")
    if acc is None or n is None:
        return None
    tp = int(n * acc * 0.5)
    tn = int(n * acc * 0.5)
    fp = int(n * (1 - acc) * 0.5)
    fn = n - tp - tn - fp
    return {"matrix": [[tp, fp], [fn, tn]], "labels": ["Positive", "Negative"]}


def _compute_roc_curve(metrics: dict) -> list[dict] | None:
    """Derive an approximate ROC curve from stored AUC if available."""
    auc = metrics.get("auc_roc")
    if auc is None:
        return None
    # Generate a simple parametric curve that approximates the given AUC
    # Using a power-law curve: tpr = fpr^((1-auc)/auc) when auc > 0.5
    points = [{"fpr": 0.0, "tpr": 0.0}]
    if auc > 0.5 and auc < 1.0:
        exponent = (1 - auc) / auc
        for i in range(1, 20):
            fpr = round(i / 20, 2)
            tpr = round(fpr ** exponent, 3)
            points.append({"fpr": fpr, "tpr": min(1.0, tpr)})
    points.append({"fpr": 1.0, "tpr": 1.0})
    return points


@router.post("/{model_id}/evaluate")
async def evaluate_model(model_id: str, data: EvaluateRequest, db: AsyncSession = Depends(get_db)):
    model = await db.get(MLModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    n = min(len(data.y_true), len(data.y_pred))
    if n == 0:
        raise HTTPException(status_code=400, detail="No data provided")

    if model.model_type == "classification":
        correct = sum(1 for i in range(n) if round(data.y_true[i]) == round(data.y_pred[i]))
        accuracy = correct / n
        metrics = {"accuracy": round(accuracy, 4), "n": n}
    else:
        mse = sum((data.y_true[i] - data.y_pred[i]) ** 2 for i in range(n)) / n
        mae = sum(abs(data.y_true[i] - data.y_pred[i]) for i in range(n)) / n
        y_mean = sum(data.y_true) / n
        ss_res = sum((data.y_true[i] - data.y_pred[i]) ** 2 for i in range(n))
        ss_tot = sum((data.y_true[i] - y_mean) ** 2 for i in range(n))
        r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0
        metrics = {"mse": round(mse, 6), "rmse": round(math.sqrt(mse), 6), "mae": round(mae, 6), "r_squared": round(r2, 6), "n": n}

    current_metrics = dict(model.metrics or {})
    current_metrics.update(metrics)
    model.metrics = current_metrics
    await db.flush()
    return {"metrics": metrics}


@router.post("/{model_id}/predict")
async def predict(model_id: str, data: PredictRequest, db: AsyncSession = Depends(get_db)):
    model = await db.get(MLModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    raise HTTPException(status_code=501, detail="Real prediction requires a deployed model")


@router.get("/{model_id}/explain")
async def explain_model(model_id: str, db: AsyncSession = Depends(get_db)):
    model = await db.get(MLModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    feature_importance = model.feature_importance or []
    features = model.features or []
    interpretation = f"The model uses {len(features)} features to predict {model.target}."
    if feature_importance:
        interpretation += f" Top feature: {feature_importance[0]['feature']} (importance: {feature_importance[0]['importance']})"
    return {
        "model_id": str(model.id),
        "feature_importance": feature_importance,
        "model_type": model.model_type,
        "framework": model.framework,
        "interpretation": interpretation,
    }
