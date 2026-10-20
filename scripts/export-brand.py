"""Forward to the resizer.

The logo source is public/brand/logo-source.png. This used to redraw a bear
from an SVG. It now runs scripts/generate-icons.mjs so an old command cannot
replace the artwork.
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
result = subprocess.run(
    ["node", "scripts/generate-icons.mjs"],
    cwd=ROOT,
    check=False,
)
sys.exit(result.returncode)
