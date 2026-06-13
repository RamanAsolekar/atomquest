import os

# Deterministic secrets for tests (override any local .env).
os.environ.setdefault("JWT_ACCESS_SECRET", "test_access_secret")
os.environ.setdefault("JWT_REFRESH_SECRET", "test_refresh_secret")
os.environ.setdefault("INVITE_TOKEN_SECRET", "test_invite_secret")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://atom:atom@localhost:5432/atom_test")
os.environ.setdefault("BCRYPT_ROUNDS", "4")  # fast hashing in tests
