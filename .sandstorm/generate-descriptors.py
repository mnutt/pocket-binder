import base64
import json
import subprocess
from pathlib import Path
result = {}
for kind, url in [('details', 'https://api.tcgdex.net/v2/en'), ('images', 'https://assets.tcgdex.net')]:
    text = f'(tags = [(id = 0xc879e379c625cdc7, value = (canonicalUrl = "{url}"))])'
    data = subprocess.check_output(['capnp', 'encode', '--packed', '-I/opt/sandstorm/latest/usr/include', '.sandstorm/powerbox.capnp', 'HttpDescriptor'], input=text.encode())
    result[kind] = base64.b64encode(data).decode()
Path('public/powerbox.json').write_text(json.dumps(result))
