#!/usr/bin/python3
"""Fixed SSH entry point installed by the operator, not updated by CI archives."""
import fcntl
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

BASE = Path('/opt/manufacturing-demo')
OVERRIDE = BASE / 'compose.release.json'
ALLOWED = {'Dockerfile', 'requirements.txt', 'server.py', 'database.py', 'health.py', 'dist', 'queries'}


def run(*args: str) -> None:
    subprocess.run(args, cwd=BASE, check=True)


def compose_up() -> None:
    run('docker', 'compose', '--env-file', '.env.demo', '-f', 'compose.demo.yaml',
        '-f', str(OVERRIDE), 'up', '-d', '--no-deps', '--no-build', 'dashboard')
    # Resolve the new container address after recreation.
    run('docker', 'compose', '--env-file', '.env.demo', '-f', 'compose.demo.yaml',
        'exec', '-T', 'web', 'nginx', '-s', 'reload')


def set_image(image: str) -> None:
    temporary = OVERRIDE.with_suffix('.tmp')
    temporary.write_text(json.dumps({'services': {'dashboard': {'image': image}}}))
    temporary.replace(OVERRIDE)


def verify() -> None:
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen('http://127.0.0.1/api/health', timeout=3) as response:
                assert json.load(response)['status'] == 'ok'
            with urllib.request.urlopen('http://127.0.0.1/api/dashboard', timeout=3) as response:
                data = json.load(response)
                assert all(key in data for key in ('orders', 'trend', 'supply'))
            return
        except (OSError, ValueError, AssertionError, KeyError):
            time.sleep(2)
    raise RuntimeError('Deployment health checks failed')


def main() -> None:
    command = os.environ.get('SSH_ORIGINAL_COMMAND', '')
    match = re.fullmatch(r'deploy ([0-9a-f]{40})', command)
    if not match:
        raise ValueError('Only deploy <commit-sha> is allowed')
    revision = match[1]
    image = 'manufacturing-demo-dashboard:' + revision
    with (BASE / '.deploy.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        payload = sys.stdin.buffer.read(10 * 1024 * 1024 + 1)
        if len(payload) > 10 * 1024 * 1024:
            raise ValueError('Archive too large')
        releases = BASE / 'releases'
        releases.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=revision + '-', dir=releases) as directory:
            target = Path(directory)
            with tarfile.open(fileobj=io.BytesIO(payload), mode='r:gz') as archive:
                members = archive.getmembers()
                if len(members) > 2000 or sum(item.size for item in members) > 30 * 1024 * 1024:
                    raise ValueError('Unpacked archive too large')
                for item in members:
                    path = PurePosixPath(item.name)
                    if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] not in ALLOWED:
                        raise ValueError('Unexpected archive path')
                    if not (item.isdir() or item.isfile()):
                        raise ValueError('Links and special files are not allowed')
                    destination = target.joinpath(*path.parts)
                    if item.isdir():
                        destination.mkdir(parents=True, exist_ok=True)
                    else:
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        with destination.open('xb') as output:
                            output.write(archive.extractfile(item).read())
            previous = subprocess.check_output(
                ['docker', 'inspect', '--format', '{{.Config.Image}}', 'manufacturing-demo-dashboard-1'],
                text=True).strip()
            run('docker', 'build', '--label', 'org.opencontainers.image.revision=' + revision,
                '-t', image, str(target))
            try:
                set_image(image)
                compose_up()
                verify()
            except Exception:
                print('Deployment failed; restoring previous application image.', flush=True)
                set_image(previous)
                compose_up()
                verify()
                raise
            (BASE / '.deployed-revision').write_text(revision + '\n')
            print('Deployed revision ' + revision, flush=True)


if __name__ == '__main__':
    main()
