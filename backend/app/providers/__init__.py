from app.providers.registry import register_provider, get_provider  # noqa: F401

# Import providers to trigger registration
import app.providers.simplefin  # noqa: F401
import app.providers.teller  # noqa: F401
import app.providers.plaid_provider  # noqa: F401
import app.providers.csv_import  # noqa: F401
import app.providers.ofx_import  # noqa: F401
