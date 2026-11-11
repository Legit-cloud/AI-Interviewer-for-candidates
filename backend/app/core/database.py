from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

settings = get_settings()

async_database_url = settings.database_url
if async_database_url.startswith("postgresql+psycopg://"):
    async_database_url = async_database_url.replace(
        "postgresql+psycopg://", "postgresql+asyncpg://", 1
    )

engine = create_async_engine(
    async_database_url,
    echo=False,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session

