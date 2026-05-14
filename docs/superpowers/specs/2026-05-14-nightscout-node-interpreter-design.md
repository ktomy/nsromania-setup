# Automatic Nightscout Node Interpreter Selection

## Context

The control panel runs hosted Nightscout instances through PM2. Each domain can select a Nightscout version directory with `NSDomain.nsversion`; when no version is selected, the runtime uses the `master` directory under `NS_HOME`.

Today all Nightscout PM2 starts use one global `NS_NODE_PATH` interpreter. That was captured as Node 14 during install, but current Nightscout releases require a newer runtime. Nightscout `v15.0.7` declares `engines.node` as `>=20.x`, so Node 14 is no longer valid for the latest version. The server already installs multiple Node versions through NVM, including Node 22.

## Goals

- Select the PM2 Node interpreter automatically per Nightscout version directory.
- Use each Nightscout directory's `package.json` as the source of truth for runtime compatibility.
- Keep manual Nightscout version installation unchanged.
- Avoid hard-coded server home paths in application code.
- Fail clearly when a compatible Node runtime cannot be found.

## Non-Goals

- Do not automate `npm install` for Nightscout versions.
- Do not create a manual mapping file from Nightscout versions to Node versions.
- Do not change PM2 process naming, ports, domain configuration, or MongoDB configuration.
- Do not remove existing deployment config keys that may still be useful for compatibility.

## Configuration

Add a new environment variable:

```text
NS_NODE_VERSIONS_DIR=/home/nsromania/.nvm/versions/node
```

This points at the directory containing NVM-managed Node installations. Runtime code scans entries such as:

```text
$NS_NODE_VERSIONS_DIR/v14.21.3/bin/node
$NS_NODE_VERSIONS_DIR/v22.11.0/bin/node
```

Tests can point `NS_NODE_VERSIONS_DIR` at fixture directories instead of relying on a real NVM install.

## Runtime Behavior

When `tryStartDomain()` starts a Nightscout domain:

1. Resolve the Nightscout directory:
   - `domain.nsversion` set: `$NS_HOME/<domain.nsversion>`
   - `domain.nsversion` empty/null in production: `$NS_HOME/master`
2. Read `<nightscout-directory>/package.json`.
3. Extract `engines.node`.
4. If `engines.node` is missing, use a legacy fallback range that selects Node 14.
5. Scan `${NS_NODE_VERSIONS_DIR}/v*/bin/node`.
6. Choose the newest installed Node version that satisfies the required range.
7. Pass the selected binary path to PM2 as `interpreter`.

The control panel should no longer use the global `NS_NODE_PATH` value for per-domain Nightscout starts. That key can remain in deployment configuration for compatibility, but the automatic resolver is authoritative for domain runtime selection.

## Error Handling

Domain startup fails before calling PM2 when:

- `NS_HOME` is missing.
- The selected Nightscout directory does not exist.
- `<nightscout-directory>/package.json` is missing, unreadable, or invalid JSON.
- `NS_NODE_VERSIONS_DIR` is missing or unreadable.
- No installed `node` binary satisfies the Nightscout `engines.node` range.

Errors should include enough context to fix the server, for example:

```text
No installed Node version in NS_NODE_VERSIONS_DIR satisfies Nightscout 15.0.7 engines.node >=20.x
```

The runtime must not silently fall back to PM2's default interpreter or to Node 22 when compatibility cannot be proven.

## Components

### Node Interpreter Resolver

Add a small service function near the Nightscout version/runtime services, for example:

```ts
resolveNightscoutNodeInterpreter(nightscoutDirectory: string): Promise<string>
```

Responsibilities:

- Read Nightscout package metadata.
- Determine the required Node range.
- Discover installed NVM Node binaries through `NS_NODE_VERSIONS_DIR`.
- Return the newest compatible `bin/node` path.
- Throw clear typed or contextual errors on configuration/runtime mismatch.

### PM2 Startup Integration

Update `tryStartDomain()` so it resolves the interpreter from the selected Nightscout directory and passes that value into:

```ts
pm2.start({
    script: 'server.js',
    cwd: nsHome,
    env: nsEnvironment,
    interpreter,
});
```

The selected interpreter should be resolved before connecting to PM2 where practical, so configuration errors do not leave PM2 connections open.

### Deployment Configuration

Update VPS deployment scripts so the control panel environment includes:

```text
NS_NODE_VERSIONS_DIR=/home/nsromania/.nvm/versions/node
```

Keep `NS_NODE_PATH` unless a later cleanup explicitly removes it.

## Version Range Handling

Use a semver-aware implementation rather than string matching. This supports ranges such as:

- `>=20.x`
- `>=16.x`
- `^22.x || ^20.x`
- `^16.x || ^14.x`

If the project does not already have an appropriate semver dependency available at runtime, add one deliberately and cover it with tests.

## Testing

Add focused unit tests for the resolver:

- `engines.node: >=20.x` selects the newest installed compatible Node, such as Node 22.
- Legacy/missing `engines.node` selects an installed Node 14 binary.
- Multiple compatible versions select the newest compatible version.
- Missing `NS_NODE_VERSIONS_DIR` fails clearly.
- Unreadable or invalid Nightscout `package.json` fails clearly.
- Unsatisfied ranges fail clearly and do not return a fallback interpreter.

Add a focused test around PM2 startup integration:

- `tryStartDomain()` passes the resolved interpreter to `pm2.start()`.

## Open Decisions

None. The approved direction is automatic per-version interpreter resolution using `NS_NODE_VERSIONS_DIR`, with startup failure when no compatible installed Node binary exists.

