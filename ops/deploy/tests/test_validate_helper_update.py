from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import re
import shlex
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock


VALIDATOR_PATH = Path(__file__).parents[1] / 'validate-helper-update.py'
DEPLOY_DIR = VALIDATOR_PATH.parent
SPEC = importlib.util.spec_from_file_location('validate_helper_update', VALIDATOR_PATH)
assert SPEC is not None and SPEC.loader is not None
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)

COMMIT = '0123456789abcdef0123456789abcdef01234567'


def helper_files() -> dict[str, bytes]:
    return {name: f'content for {name}\n'.encode() for name in VALIDATOR.EXPECTED_FILES}


def valid_manifest(files: dict[str, bytes]) -> dict[str, object]:
    return {
        'schemaVersion': 1,
        'sourceCommit': COMMIT,
        'createdAt': '2026-08-15T12:00:00Z',
        'files': {
            name: {
                **VALIDATOR.EXPECTED_FILES[name],
                'sha256': hashlib.sha256(content).hexdigest(),
            }
            for name, content in files.items()
        },
    }


def create_archive(
    path: Path,
    files: dict[str, bytes] | None = None,
    manifest: dict[str, object] | None = None,
    extra_members: list[tarfile.TarInfo] | None = None,
) -> None:
    content_files = files or helper_files()
    manifest_content = json.dumps(manifest or valid_manifest(content_files)).encode()
    with tarfile.open(path, mode='w:gz') as archive:
        for name, content in {**content_files, VALIDATOR.MANIFEST_NAME: manifest_content}.items():
            member = tarfile.TarInfo(name)
            member.size = len(content)
            member.mode = 0o600
            archive.addfile(member, io.BytesIO(content))
        for member in extra_members or []:
            archive.addfile(member)


def bash_array(script: str, name: str) -> list[str]:
    match = re.search(rf'readonly -a {name}=\((.*?)\n\)', script, flags=re.DOTALL)
    if match is None:
        raise AssertionError(f'Unable to find Bash array {name}.')
    return shlex.split(match.group(1), comments=False, posix=True)


class ValidateHelperUpdateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_directory = tempfile.TemporaryDirectory()
        self.archive = Path(self.temp_directory.name) / 'helpers.tar.gz'

    def tearDown(self) -> None:
        self.temp_directory.cleanup()

    def test_accepts_complete_allowlisted_archive(self) -> None:
        create_archive(self.archive)
        total_bytes, member_count = VALIDATOR.validate(str(self.archive), COMMIT)
        self.assertGreater(total_bytes, 0)
        self.assertEqual(member_count, len(VALIDATOR.EXPECTED_FILES) + 1)

    def test_rejects_missing_helper(self) -> None:
        files = helper_files()
        del files['health-check.mjs']
        create_archive(self.archive, files, valid_manifest(files))
        with self.assertRaisesRegex(VALIDATOR.ValidationError, 'missing required members'):
            VALIDATOR.validate(str(self.archive), COMMIT)

    def test_rejects_unexpected_path(self) -> None:
        unexpected = tarfile.TarInfo('../escape')
        unexpected.size = 0
        create_archive(self.archive, extra_members=[unexpected])
        with self.assertRaisesRegex(VALIDATOR.ValidationError, 'unexpected member'):
            VALIDATOR.validate(str(self.archive), COMMIT)

    def test_rejects_symbolic_link(self) -> None:
        files = helper_files()
        del files['activate-release.sh']
        link = tarfile.TarInfo('activate-release.sh')
        link.type = tarfile.SYMTYPE
        link.linkname = 'authorized-command.sh'
        create_archive(self.archive, files, valid_manifest(helper_files()), [link])
        with self.assertRaisesRegex(VALIDATOR.ValidationError, 'not a regular file'):
            VALIDATOR.validate(str(self.archive), COMMIT)

    def test_rejects_duplicate_member(self) -> None:
        duplicate = tarfile.TarInfo('activate-release.sh')
        duplicate.size = 0
        create_archive(self.archive, extra_members=[duplicate])
        with self.assertRaisesRegex(VALIDATOR.ValidationError, 'duplicate member'):
            VALIDATOR.validate(str(self.archive), COMMIT)

    def test_rejects_wrong_commit(self) -> None:
        create_archive(self.archive)
        with self.assertRaisesRegex(VALIDATOR.ValidationError, 'manifest commit'):
            VALIDATOR.validate(str(self.archive), 'f' * 40)

    def test_rejects_modified_helper_content(self) -> None:
        files = helper_files()
        manifest = valid_manifest(files)
        files['activate-release.sh'] = b'modified after manifest creation\n'
        create_archive(self.archive, files, manifest)
        with self.assertRaisesRegex(VALIDATOR.ValidationError, 'content checksum'):
            VALIDATOR.validate(str(self.archive), COMMIT)

    def test_rejects_changed_target(self) -> None:
        files = helper_files()
        manifest = valid_manifest(files)
        manifest['files']['activate-release.sh']['target'] = '/tmp/unsafe'  # type: ignore[index]
        create_archive(self.archive, files, manifest)
        with self.assertRaisesRegex(VALIDATOR.ValidationError, 'target or mode'):
            VALIDATOR.validate(str(self.archive), COMMIT)

    def test_rejects_oversized_compressed_archive_before_opening_it(self) -> None:
        self.archive.write_bytes(b'not a tar archive')
        with mock.patch.object(VALIDATOR.os.path, 'getsize', return_value=VALIDATOR.MAX_ARCHIVE_BYTES + 1):
            with self.assertRaisesRegex(VALIDATOR.ValidationError, 'compressed archive'):
                VALIDATOR.validate(str(self.archive), COMMIT)

    def test_local_and_server_allowlists_match_validator(self) -> None:
        local_script = (DEPLOY_DIR / 'update-server-helpers.sh').read_text(encoding='utf8')
        server_script = (DEPLOY_DIR / 'update-deploy-helpers-on-server.sh').read_text(encoding='utf8')

        names = list(VALIDATOR.EXPECTED_FILES)
        targets = [record['target'] for record in VALIDATOR.EXPECTED_FILES.values()]
        modes = [record['mode'] for record in VALIDATOR.EXPECTED_FILES.values()]

        self.assertEqual(bash_array(local_script, 'PAYLOAD_NAMES'), names)
        self.assertEqual(bash_array(server_script, 'PAYLOAD_NAMES'), names)
        self.assertEqual(bash_array(server_script, 'TARGETS'), targets)
        self.assertEqual(bash_array(server_script, 'MODES'), modes)

    def test_bootstrap_installs_every_root_receiver_prerequisite(self) -> None:
        bootstrap = (DEPLOY_DIR / 'bootstrap-server.sh').read_text(encoding='utf8')
        for required in (
            'update-deploy-helpers-on-server.sh',
            'validate-helper-update.py',
            'helper-update-work',
            'helper-update.lock',
            'deployment.lock',
            'helper-updates',
        ):
            self.assertIn(required, bootstrap)
        self.assertIn("'root:root:2711'", bootstrap)

    def test_activation_and_helper_update_share_the_deployment_lock(self) -> None:
        activation = (DEPLOY_DIR / 'activate-release.sh').read_text(encoding='utf8')
        receiver = (DEPLOY_DIR / 'update-deploy-helpers-on-server.sh').read_text(encoding='utf8')
        bootstrap = (DEPLOY_DIR / 'bootstrap-server.sh').read_text(encoding='utf8')

        for script in (activation, receiver, bootstrap):
            self.assertIn('deployment.lock', script)
            self.assertRegex(script, r'flock -n [89]')
        self.assertIn('trap rollback ERR HUP INT TERM', receiver)
        self.assertIn('set -o noclobber', bootstrap)
        self.assertNotRegex(bootstrap, r'install[^\n]+"\$DEPLOYMENT_LOCK"')

    def test_receiver_normalizes_manifest_modes_for_stat_output(self) -> None:
        receiver = (DEPLOY_DIR / 'update-deploy-helpers-on-server.sh').read_text(encoding='utf8')
        mode_probe = Path(self.temp_directory.name) / 'mode-probe'
        mode_probe.touch()
        mode_probe.chmod(0o755)
        actual_mode = subprocess.check_output(['stat', '-c', '%a', mode_probe], text=True).strip()

        self.assertEqual(actual_mode, VALIDATOR.EXPECTED_FILES['activate-release.sh']['mode'].lstrip('0'))
        self.assertGreaterEqual(receiver.count('${MODES[$index]#0}'), 2)

    def test_receiver_fault_restores_existing_and_preserves_new_targets(self) -> None:
        receiver = (DEPLOY_DIR / 'update-deploy-helpers-on-server.sh').read_text(encoding='utf8')
        fail_function = receiver[receiver.index('fail() {') : receiver.index('\npm2() {')]
        transaction_functions = receiver[
            receiver.index('backup_file_or_record_missing() {') : receiver.index('\ntrap cleanup EXIT')
        ]

        root = Path(self.temp_directory.name)
        existing = root / 'installed' / 'existing-helper'
        newly_created = root / 'installed' / 'new-helper'
        state = root / 'control' / 'state.json'
        backup = root / 'backup'
        existing.parent.mkdir()
        state.parent.mkdir()
        backup.mkdir()
        existing.write_text('original\n', encoding='utf8')

        values = {path.name: shlex.quote(str(path)) for path in (existing, newly_created, state, backup)}
        harness = f'''#!/usr/bin/env bash
set -Eeuo pipefail
TARGETS=({values['existing-helper']} {values['new-helper']})
STATE_FILE={values['state.json']}
BACKUP_PATH={values['backup']}
WORK_ROOT={shlex.quote(str(root / 'work'))}
WORK_DIR=''
ACTIVE_TEMP=''
INSTALL_STARTED=0
PANEL_PID_BEFORE=123
{fail_function}
{transaction_functions}
visudo() {{ return 0; }}
panel_pid() {{ printf '123\\n'; }}
verify_panel_health() {{ return 0; }}
for target in "${{TARGETS[@]}}" "$STATE_FILE"; do
    backup_file_or_record_missing "$target"
done
trap rollback ERR
INSTALL_STARTED=1
printf 'modified\\n' > {values['existing-helper']}
printf 'new\\n' > {values['new-helper']}
printf '{{"status":"new"}}\\n' > {values['state.json']}
fail 'injected post-install verification failure'
'''

        result = subprocess.run(['bash'], input=harness, text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(existing.read_text(encoding='utf8'), 'original\n')
        self.assertFalse(newly_created.exists())
        self.assertFalse(state.exists())
        self.assertEqual(
            (backup / 'failed-installed' / newly_created.relative_to('/')).read_text(encoding='utf8'),
            'new\n',
        )
        self.assertEqual(
            (backup / 'failed-new' / state.relative_to('/')).read_text(encoding='utf8'),
            '{"status":"new"}\n',
        )


if __name__ == '__main__':
    unittest.main()
