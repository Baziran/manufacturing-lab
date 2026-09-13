"""Add missing Mongo secrets; never print them or rotate existing credentials."""
import os
from pathlib import Path
import secrets
import sys

name = sys.argv[1] if len(sys.argv)>1 else '.env.demo'
if name not in ('.env','.env.demo'):
    raise SystemExit('Use .env or .env.demo from the project directory')
path = Path(name)
text = path.read_text()
for key in ('MONGO_ROOT_PASSWORD','MONGO_READER_PASSWORD'):
    if not any(line.startswith(key+'=') and line.split('=',1)[1].strip() for line in text.splitlines()):
        text = '\n'.join(line for line in text.splitlines() if not line.startswith(key+'='))+'\n'
        text += '\n'+key+'='+secrets.token_hex(32)+'\n'
os.chmod(path,0o600)
path.write_text(text)
print('MongoDB credentials ready; existing values preserved.')
