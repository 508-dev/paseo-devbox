# Devbox for Paseo

The workspace panel shows the services associated with an exact checkout. It
hands the selected workspace and service to the Devbox CLI on the device where
you want to preview or edit it. The CLI applies its normal host verification
and private connection rules.

- The daemon and app need Paseo 0.13.0 through the 0.16 series. Detected listeners
  and editor handoffs need the current signed Devbox workspace helper.
- The Devbox CLI needs a saved connection for the same host and account. The
  root of the workspace must be covered by Devbox discovery.
- The plugin reports remote service observations. A forward is a local CLI
  process. Its lifetime and the development server's lifetime are independent.

## Install on the Paseo daemon host

Enable plugins in Paseo for the intended daemon, then run:

```sh
paseo plugin install git:508-dev/paseo-devbox
paseo plugin ls paseo-devbox
```

Open the **Devbox** workspace panel and enter the connection ID from
`devbox connection list` on your laptop. Run copied commands in that laptop's
terminal using a companion-capable Devbox CLI. The preview starts a
private loopback forward and stays attached until you stop it with Ctrl+C.

## Development

Use Node.js 24 and the locked development dependencies:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm pack --dry-run --ignore-scripts
```

Paseo supplies the runtime libraries. Install a development checkout by
absolute directory path on an isolated daemon to test changes.
