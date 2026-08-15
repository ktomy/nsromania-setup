#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tarfile


MAX_MEMBER_BYTES = 2_000_000
MAX_TOTAL_BYTES = 10_000_000
MAX_ARCHIVE_BYTES = 10_000_000
MANIFEST_NAME = 'helper-manifest.json'
EXPECTED_FILES = {
    'activate-release.sh': {
        'target': '/usr/local/sbin/nsromania-activate-release',
        'mode': '0755',
    },
    'authorized-command.sh': {
        'target': '/usr/local/libexec/nsromania-deploy-command',
        'mode': '0755',
    },
    'validate-artifact.py': {
        'target': '/usr/local/libexec/nsromania-validate-artifact',
        'mode': '0755',
    },
    'health-check.mjs': {
        'target': '/usr/local/libexec/nsromania-health-check.mjs',
        'mode': '0755',
    },
    'port-check.mjs': {
        'target': '/usr/local/libexec/nsromania-port-check.mjs',
        'mode': '0755',
    },
    'nsromania-github-deploy.sudoers': {
        'target': '/etc/sudoers.d/nsromania-github-deploy',
        'mode': '0440',
    },
    'update-deploy-helpers-on-server.sh': {
        'target': '/usr/local/sbin/nsromania-update-deploy-helpers',
        'mode': '0755',
    },
    'validate-helper-update.py': {
        'target': '/usr/local/libexec/nsromania-validate-helper-update',
        'mode': '0755',
    },
}


class ValidationError(Exception):
    pass


def _read_member(archive: tarfile.TarFile, member: tarfile.TarInfo) -> bytes:
    extracted = archive.extractfile(member)
    if extracted is None:
        raise ValidationError(f'unable to read archive member: {member.name!r}')
    return extracted.read()


def validate(archive_path: str, expected_commit: str) -> tuple[int, int]:
    if re.fullmatch(r'[0-9a-f]{40}', expected_commit) is None:
        raise ValidationError('expected commit must be a 40-character lowercase hexadecimal SHA')
    if os.path.getsize(archive_path) > MAX_ARCHIVE_BYTES:
        raise ValidationError('compressed archive exceeds the configured safety limit')

    expected_names = set(EXPECTED_FILES) | {MANIFEST_NAME}
    members_by_name: dict[str, tarfile.TarInfo] = {}
    total_bytes = 0

    with tarfile.open(archive_path, mode='r:gz') as archive:
        for member in archive:
            name = member.name
            if name in members_by_name:
                raise ValidationError(f'archive contains a duplicate member: {name!r}')
            if name not in expected_names:
                raise ValidationError(f'archive contains an unexpected member: {name!r}')
            if not member.isfile():
                raise ValidationError(f'archive member is not a regular file: {name!r}')
            if member.size > MAX_MEMBER_BYTES:
                raise ValidationError(f'archive member is too large: {name!r}')
            total_bytes += member.size
            if total_bytes > MAX_TOTAL_BYTES:
                raise ValidationError('archive expands beyond the configured safety limit')
            members_by_name[name] = member

        missing = sorted(expected_names - set(members_by_name))
        if missing:
            raise ValidationError(f'archive is missing required members: {", ".join(missing)}')

        manifest_member = members_by_name[MANIFEST_NAME]
        try:
            manifest = json.loads(_read_member(archive, manifest_member).decode('utf8', errors='strict'))
        except (UnicodeError, json.JSONDecodeError) as error:
            raise ValidationError('helper manifest is not valid UTF-8 JSON') from error

        if set(manifest) != {'schemaVersion', 'sourceCommit', 'createdAt', 'files'}:
            raise ValidationError('helper manifest has unexpected fields')
        if manifest['schemaVersion'] != 1:
            raise ValidationError('helper manifest has an unsupported schema version')
        if manifest['sourceCommit'] != expected_commit:
            raise ValidationError('helper manifest commit does not match the requested commit')
        if not isinstance(manifest['createdAt'], str) or re.fullmatch(
            r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z', manifest['createdAt']
        ) is None:
            raise ValidationError('helper manifest has an invalid creation timestamp')
        if not isinstance(manifest['files'], dict) or set(manifest['files']) != set(EXPECTED_FILES):
            raise ValidationError('helper manifest file list does not match the allowlist')

        for name, expected in EXPECTED_FILES.items():
            record = manifest['files'][name]
            if not isinstance(record, dict) or set(record) != {'target', 'mode', 'sha256'}:
                raise ValidationError(f'helper manifest record is invalid: {name!r}')
            if record['target'] != expected['target'] or record['mode'] != expected['mode']:
                raise ValidationError(f'helper manifest target or mode differs from the allowlist: {name!r}')
            if re.fullmatch(r'[0-9a-f]{64}', record['sha256']) is None:
                raise ValidationError(f'helper manifest checksum is invalid: {name!r}')

            content = _read_member(archive, members_by_name[name])
            if hashlib.sha256(content).hexdigest() != record['sha256']:
                raise ValidationError(f'helper content checksum differs from the manifest: {name!r}')

    return total_bytes, len(members_by_name)


def main() -> int:
    if len(sys.argv) != 3:
        print(f'Usage: {sys.argv[0]} ARCHIVE COMMIT_SHA', file=sys.stderr)
        return 2

    try:
        total_bytes, member_count = validate(sys.argv[1], sys.argv[2])
    except (OSError, tarfile.TarError, ValidationError) as error:
        print(f'Helper update validation failed: {error}', file=sys.stderr)
        return 1

    print(total_bytes, member_count)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
