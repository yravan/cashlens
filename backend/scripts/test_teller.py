"""Quick test script for Teller provider.

Usage:
    # With sandbox (no certs needed):
    python scripts/test_teller.py --token test_token_ky6igyqi3qxa4

    # With development (real bank, needs certs):
    python scripts/test_teller.py --token <your_access_token> \
        --cert ./certs/teller/certificate.pem \
        --key ./certs/teller/private_key.pem
"""

import argparse
import asyncio
import json
import sys
from datetime import date, timedelta
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


async def main(access_token: str, cert_path: str | None, key_path: str | None):
    from app.providers.teller import TellerProvider

    provider = TellerProvider(
        access_token=access_token,
        cert_path=cert_path,
        key_path=key_path,
    )

    print("=" * 60)
    print("Fetching accounts...")
    print("=" * 60)
    try:
        accounts = await provider.fetch_accounts()
    except Exception as e:
        print(f"\nERROR fetching accounts: {e}")
        print("\nCommon issues:")
        print("  - Wrong access token")
        print("  - Cert files not found or invalid (for development env)")
        print("  - Teller enrollment expired")
        return

    if not accounts:
        print("No accounts found.")
        return

    for acct in accounts:
        print(f"\n  {acct.name}")
        print(f"    ID:          {acct.provider_id}")
        print(f"    Institution: {acct.institution_name}")
        print(f"    Type:        {acct.account_type} / {acct.account_subtype}")
        print(f"    Mask:        ****{acct.mask}")
        print(f"    Balance:     ${acct.balance_current}")
        print(f"    Available:   ${acct.balance_available}")

    print(f"\n{'=' * 60}")
    print(f"Fetching transactions (last 30 days)...")
    print(f"{'=' * 60}")

    start = date.today() - timedelta(days=30)
    for acct in accounts:
        txns = await provider.fetch_transactions(
            account_id=acct.provider_id,
            start_date=start,
            include_pending=True,
        )
        print(f"\n  {acct.name}: {len(txns)} transactions")
        for tx in txns[:10]:  # Show first 10
            status = "PENDING" if tx.status == "pending" else "       "
            print(
                f"    {tx.date}  {status}  {tx.amount:>10}  {tx.description[:40]}"
            )
        if len(txns) > 10:
            print(f"    ... and {len(txns) - 10} more")

    # Dump full JSON for first account
    if accounts:
        first_acct = accounts[0]
        txns = await provider.fetch_transactions(
            account_id=first_acct.provider_id,
            start_date=start,
        )
        print(f"\n{'=' * 60}")
        print(f"Full JSON for {first_acct.name} ({len(txns)} txns):")
        print(f"{'=' * 60}")
        print(
            json.dumps(
                [t.model_dump(mode="json") for t in txns[:3]],
                indent=2,
                default=str,
            )
        )
        if len(txns) > 3:
            print(f"  ... ({len(txns) - 3} more omitted)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test Teller provider")
    parser.add_argument("--token", required=True, help="Teller access token")
    parser.add_argument("--cert", default=None, help="Path to certificate.pem")
    parser.add_argument("--key", default=None, help="Path to private_key.pem")
    args = parser.parse_args()

    # Auto-detect certs from .env if not specified
    if args.cert is None and Path("./certs/teller/certificate.pem").exists():
        args.cert = "./certs/teller/certificate.pem"
        args.key = "./certs/teller/private_key.pem"
        print(f"Auto-detected certs at {args.cert}")

    asyncio.run(main(args.token, args.cert, args.key))
