"""Camera receipt scanning via LLM vision.

Adapted from bhimrazy/receipt-ocr — swapped to OpenRouter + Instructor.
Image preprocessing: resize to 1024px max, JPEG quality 85.
Cost: ~$0.0003 per receipt with Gemini 2.5 Flash-Lite.
"""

import base64
import io
import logging

from PIL import Image

from app.llm.client import MODEL_FALLBACK_EXTRA, VISION_MODEL, get_instructor_client
from app.llm.models import ReceiptData

logger = logging.getLogger(__name__)


def preprocess_image(image_bytes: bytes, max_size: int = 1024) -> str:
    """Resize, convert to JPEG, return as base64 data URL."""
    img = Image.open(io.BytesIO(image_bytes))

    # Resize preserving aspect ratio
    if max(img.size) > max_size:
        ratio = max_size / max(img.size)
        new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
        img = img.resize(new_size, Image.LANCZOS)

    # Convert to RGB (drop alpha) and compress as JPEG
    if img.mode != "RGB":
        img = img.convert("RGB")

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:image/jpeg;base64,{b64}"


async def scan_receipt(image_bytes: bytes) -> ReceiptData | None:
    """Extract structured receipt data from an image using LLM vision."""
    data_url = preprocess_image(image_bytes)

    client = get_instructor_client()
    try:
        result = await client.chat.completions.create(
            model=VISION_MODEL,
            response_model=ReceiptData,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Extract all receipt data from this image. "
                        "Include merchant name, date, line items with prices, "
                        "subtotal, tax, tip, and total. "
                        "Amounts should be numeric (no currency symbols)."
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url},
                        }
                    ],
                },
            ],
            extra_body=MODEL_FALLBACK_EXTRA,
        )
        return result
    except Exception:
        logger.exception("Failed to scan receipt")
        return None
