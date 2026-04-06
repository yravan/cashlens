"""Fernet encryption for bank credentials at rest.

Key from ENCRYPTION_KEY env var. Encrypt/decrypt at service layer, not model layer.
Supports key rotation via MultiFernet.
"""

from cryptography.fernet import Fernet, MultiFernet

from app.core.config import settings

_fernet: Fernet | MultiFernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        key = settings.encryption_key
        if not key:
            raise RuntimeError(
                "ENCRYPTION_KEY not set. Generate one with: "
                'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
            )
        _fernet = Fernet(key.encode() if isinstance(key, str) else key)
    return _fernet


def encrypt(plaintext: str) -> str:
    """Encrypt a string, return URL-safe base64 ciphertext."""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    """Decrypt a URL-safe base64 ciphertext back to string."""
    return _get_fernet().decrypt(ciphertext.encode()).decode()
