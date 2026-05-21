from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # App
    app_name: str = "Dataset Management Solution"
    app_version: str = "1.0.0"
    debug: bool = False

    # Database
    db_host: str = "localhost"
    db_port: int = 5432
    db_user: str = "postgres"
    db_password: str = "postgres"
    db_name: str = "dataset_pipeline"

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    @property
    def sync_database_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    # File storage
    uploads_dir: str = "./data/uploads"
    exports_dir: str = "./data/exports"
    embeddings_dir: str = "./data/embeddings"

    # CORS
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:8080",
        "http://localhost",
    ]

    # Roboflow
    roboflow_api_key: str = ""

    # Embedding model: "resnet50" | "clip"
    embedding_model: str = "resnet50"


@lru_cache
def get_settings() -> Settings:
    return Settings()
