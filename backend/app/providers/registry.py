"""Provider registry — decorators and factory for bank data providers."""

from app.providers.protocol import BankProvider

_PROVIDER_REGISTRY: dict[str, type] = {}


def register_provider(name: str):
    """Decorator to register a provider class."""

    def decorator(cls):
        _PROVIDER_REGISTRY[name] = cls
        return cls

    return decorator


def get_provider(name: str, **kwargs) -> BankProvider:
    """Factory to instantiate a provider by name."""
    cls = _PROVIDER_REGISTRY.get(name)
    if not cls:
        raise ValueError(
            f"Unknown provider: {name}. Available: {list(_PROVIDER_REGISTRY)}"
        )
    return cls(**kwargs)


def list_providers() -> list[str]:
    """Return names of all registered providers."""
    return list(_PROVIDER_REGISTRY.keys())
