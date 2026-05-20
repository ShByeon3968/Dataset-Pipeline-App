"""
클래스 CRUD 서비스
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models import Class

CLASS_COLORS = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7",
    "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9",
    "#F0B27A", "#82E0AA", "#F1948A", "#76D7C4", "#AED6F1",
    "#D7BDE2", "#A9DFBF", "#FAD7A0", "#A3E4D7", "#D2B4DE",
]


async def get_or_create_class(db: AsyncSession, dataset_id: int, name: str) -> Class:
    stmt = select(Class).where(Class.dataset_id == dataset_id, Class.name == name)
    result = await db.execute(stmt)
    cls = result.scalar_one_or_none()
    if cls:
        return cls

    count_res = await db.execute(
        select(func.count()).select_from(Class).where(Class.dataset_id == dataset_id)
    )
    count = count_res.scalar() or 0
    color = CLASS_COLORS[count % len(CLASS_COLORS)]
    cls = Class(dataset_id=dataset_id, name=name, color=color)
    db.add(cls)
    await db.flush()
    return cls
