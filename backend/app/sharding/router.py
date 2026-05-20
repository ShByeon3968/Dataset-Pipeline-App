"""
ShardRouter — dataset_id를 받아 올바른 AsyncSession을 반환하는 라우터.

FastAPI Depends로 주입해서 사용합니다:

    @router.get("/{dataset_id}/images")
    async def list_images(
        dataset_id: int,
        db: AsyncSession = Depends(get_sharded_db(dataset_id)),
    ): ...

단일 DB 모드(SHARD_COUNT=1)에서는 기존 get_db()와 동일하게 동작합니다.
"""
from contextlib import asynccontextmanager
from sqlalchemy.ext.asyncio import (
    AsyncSession, AsyncEngine,
    create_async_engine, async_sessionmaker,
)
from app.sharding.config import ShardConfig, build_shard_configs, PARTITION_COUNT
from app.sharding.registry import ShardRegistry
from app.database import Base


class ShardRouter:
    """
    여러 샤드 엔진을 관리하고, dataset_id로 올바른 세션을 라우팅합니다.
    """

    def __init__(self):
        self._engines: dict[int, AsyncEngine] = {}
        self._sessions: dict[int, async_sessionmaker] = {}
        self._configs: list[ShardConfig] = []
        self.registry: ShardRegistry | None = None

    async def initialize(self):
        """애플리케이션 시작 시 모든 샤드 엔진 초기화."""
        self._configs = build_shard_configs()
        shard_count = len(self._configs)

        for cfg in self._configs:
            engine = create_async_engine(
                cfg.db_url,
                echo=False,
                pool_pre_ping=True,
                pool_size=5,
                max_overflow=10,
            )
            self._engines[cfg.shard_id] = engine
            self._sessions[cfg.shard_id] = async_sessionmaker(
                bind=engine,
                class_=AsyncSession,
                expire_on_commit=False,
                autocommit=False,
                autoflush=False,
            )
            # 각 샤드 DB에 테이블 생성
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)

        # 메타 DB = shard_0
        self.registry = ShardRegistry(
            meta_db_url=self._configs[0].db_url,
            shard_count=shard_count,
        )
        await self.registry.initialize()

    async def get_session_for_dataset(self, dataset_id: int) -> AsyncSession:
        """dataset_id에 해당하는 샤드의 세션 반환."""
        if self.registry is None:
            raise RuntimeError("ShardRouter가 초기화되지 않았습니다.")

        shard_id = await self.registry.lookup(dataset_id)

        # 등록되지 않은 경우 (레거시 데이터 등) → 새로 배정
        if shard_id is None:
            shard_id = await self.registry.assign(dataset_id)

        session_factory = self._sessions.get(shard_id)
        if session_factory is None:
            raise ValueError(f"샤드 {shard_id}를 찾을 수 없습니다.")

        return session_factory()

    async def assign_dataset(self, dataset_id: int) -> int:
        """새 데이터셋을 샤드에 배정하고 샤드 ID 반환."""
        if self.registry is None:
            raise RuntimeError("ShardRouter가 초기화되지 않았습니다.")
        return await self.registry.assign(dataset_id)

    async def remove_dataset(self, dataset_id: int):
        """데이터셋 삭제 시 샤드 매핑 제거."""
        if self.registry:
            await self.registry.remove(dataset_id)

    def get_meta_session(self) -> AsyncSession:
        """메타 DB(shard_0) 세션 반환 — 데이터셋 목록 조회 등에 사용."""
        return self._sessions[0]()

    @property
    def shard_count(self) -> int:
        return len(self._configs)

    def stats(self) -> dict:
        """샤딩 현황 반환 (운영 모니터링용)."""
        return {
            "shard_count": self.shard_count,
            "partition_count": PARTITION_COUNT,
            "distribution": self.registry.shard_stats() if self.registry else {},
        }

    async def close(self):
        for engine in self._engines.values():
            await engine.dispose()


# ── 싱글톤 인스턴스 ────────────────────────────────────────────
shard_router = ShardRouter()


# ── FastAPI Depends 헬퍼 ───────────────────────────────────────

async def get_sharded_db(dataset_id: int):
    """
    dataset_id를 기반으로 올바른 샤드의 AsyncSession을 주입합니다.

    사용법:
        @router.get("/{dataset_id}/images")
        async def list_images(
            dataset_id: int,
            db: AsyncSession = Depends(lambda: get_sharded_db(dataset_id)),
        ): ...
    """
    session = await shard_router.get_session_for_dataset(dataset_id)
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


async def get_meta_db():
    """메타 DB 세션 주입 (데이터셋 목록 등 샤드 무관 쿼리용)."""
    session = shard_router.get_meta_session()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()
