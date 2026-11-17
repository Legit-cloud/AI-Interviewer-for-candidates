# Multi-stage build for Vren AI FastAPI backend
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1

# Copy dependency definition
COPY pyproject.toml uv.lock* /app/

# Install dependencies into virtual environment
RUN uv sync --no-dev --no-install-project

# Final runtime image
FROM python:3.12-slim-bookworm AS runner

WORKDIR /app

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Copy virtual environment from builder
COPY --from=builder /app/.venv /app/.venv

# Copy application source
COPY app /app/app
COPY alembic /app/alembic
COPY alembic.ini /app/alembic.ini

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/v1/health').read()" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
